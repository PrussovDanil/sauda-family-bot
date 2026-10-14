import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SHARING_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${SHARING_SCOPE}`;

interface StoredCredentials {
  clientId: string;
  hostId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  scopes: string[];
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

@Injectable()
export class ChatGptAuthService {
  private refreshPromise?: Promise<StoredCredentials>;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.config.get<string>('OPENAI_AUTH_MODE') === 'chatgpt';
  }

  async signIn(): Promise<{ sharing: boolean; email?: string }> {
    let previous: StoredCredentials | undefined;
    try {
      previous = await this.readCredentials();
    } catch (error) {
      if (!this.isFileNotFound(error)) throw error;
    }
    const hostId = previous?.hostId ?? `urn:uuid:${randomUUID()}`;
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const callback = await this.listenForCallback(state);
    const clientId = previous?.clientId ?? 'dynamic_agent_client';
    const authorization = new URL(`${ISSUER}/api/accounts/authorize`);
    authorization.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: callback.redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      ext_agent_host_id: hostId,
      agent_name_hint: 'Sauda Family Bot',
      ...(previous ? { id_token_hint: previous.idToken } : {}),
    }).toString();

    console.log('Открываю безопасную страницу входа ChatGPT в браузере.');
    this.openBrowser(authorization.toString());
    const result = await callback.result;
    const issuedClientId = result.clientId ?? previous?.clientId;
    if (!issuedClientId || issuedClientId === 'dynamic_agent_client') {
      throw new Error('ChatGPT did not issue a client ID');
    }
    const token = await this.requestToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: issuedClientId,
        code: result.code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUri,
        resource: RESOURCE,
      }),
    );
    const identity = await this.verifyIdentity(
      token.id_token,
      issuedClientId,
      nonce,
    );
    const credentials = this.toCredentials(token, issuedClientId, hostId);
    await this.writeCredentials(credentials);
    return {
      sharing: credentials.scopes.includes(SHARING_SCOPE),
      ...(identity.email ? { email: identity.email } : {}),
    };
  }

  async getAccessToken(): Promise<string> {
    const credentials = await this.readCredentials();
    if (!credentials.scopes.includes(SHARING_SCOPE)) {
      throw new Error('ChatGPT plan usage was not granted');
    }
    if (credentials.expiresAt > Date.now() + 60_000) {
      return credentials.accessToken;
    }
    this.refreshPromise ??= this.refresh(credentials).finally(() => {
      this.refreshPromise = undefined;
    });
    return (await this.refreshPromise).accessToken;
  }

  private async refresh(
    current: StoredCredentials,
  ): Promise<StoredCredentials> {
    const token = await this.requestToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: current.clientId,
        refresh_token: current.refreshToken,
        resource: RESOURCE,
      }),
    );
    const next = this.toCredentials(token, current.clientId, current.hostId);
    await this.verifyIdentity(token.id_token, current.clientId);
    await this.writeCredentials(next);
    return next;
  }

  private async requestToken(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const data: unknown = await response.json();
    if (!response.ok || !this.isTokenResponse(data)) {
      throw new Error('ChatGPT token exchange failed');
    }
    return data;
  }

  private async verifyIdentity(
    idToken: string,
    clientId: string,
    nonce?: string,
  ): Promise<{ email?: string }> {
    const discoveryResponse = await fetch(
      `${ISSUER}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const discovery = (await discoveryResponse.json()) as {
      issuer?: string;
      jwks_uri?: string;
    };
    if (
      !discoveryResponse.ok ||
      discovery.issuer !== ISSUER ||
      !discovery.jwks_uri ||
      new URL(discovery.jwks_uri).origin !== ISSUER
    ) {
      throw new Error('ChatGPT identity configuration is invalid');
    }
    const { payload } = await jwtVerify(
      idToken,
      createRemoteJWKSet(new URL(discovery.jwks_uri)),
      { issuer: ISSUER, audience: clientId, algorithms: ['RS256'] },
    );
    if (nonce !== undefined && payload.nonce !== nonce) {
      throw new Error('ChatGPT identity nonce is invalid');
    }
    return typeof payload.email === 'string' ? { email: payload.email } : {};
  }

  private async listenForCallback(state: string): Promise<{
    redirectUri: string;
    result: Promise<{ code: string; clientId?: string }>;
  }> {
    let resolveResult!: (value: { code: string; clientId?: string }) => void;
    let rejectResult!: (reason: Error) => void;
    const result = new Promise<{ code: string; clientId?: string }>(
      (resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      },
    );
    const timeout = setTimeout(() => {
      server.close();
      rejectResult(new Error('ChatGPT authorization timed out'));
    }, 10 * 60_000);
    timeout.unref();
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const actual = Buffer.from(url.searchParams.get('state') ?? '');
      const expected = Buffer.from(state);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        response.writeHead(400).end('Invalid state');
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Authorization failed');
        rejectResult(new Error('ChatGPT authorization failed'));
      } else {
        response
          .writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          .end('Authorization completed. You can close this tab.');
        resolveResult({
          code,
          ...(url.searchParams.get('client_id')
            ? { clientId: url.searchParams.get('client_id')! }
            : {}),
        });
      }
      clearTimeout(timeout);
      server.close();
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Could not start OAuth callback server');
    }
    return {
      redirectUri: `http://127.0.0.1:${address.port}/auth/callback`,
      result,
    };
  }

  private openBrowser(url: string): void {
    const child = spawn('xdg-open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  private toCredentials(
    token: TokenResponse,
    clientId: string,
    hostId: string,
  ): StoredCredentials {
    return {
      clientId,
      hostId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token,
      scopes: token.scope.split(/\s+/).filter(Boolean),
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  }

  private isTokenResponse(value: unknown): value is TokenResponse {
    if (!value || typeof value !== 'object') return false;
    const token = value as Partial<TokenResponse>;
    return (
      typeof token.access_token === 'string' &&
      typeof token.refresh_token === 'string' &&
      typeof token.id_token === 'string' &&
      token.token_type?.toLowerCase() === 'bearer' &&
      typeof token.expires_in === 'number' &&
      token.expires_in > 0 &&
      typeof token.scope === 'string'
    );
  }

  private isFileNotFound(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }

  private credentialPath(): string {
    return resolve(
      this.config.get<string>('OPENAI_CHATGPT_CREDENTIAL_PATH') ??
        './data/openai-chatgpt.enc.json',
    );
  }

  private encryptionKey(): Buffer {
    const encoded = this.config
      .get<string>('OPENAI_CHATGPT_CREDENTIAL_KEY')
      ?.trim();
    const key = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) {
      throw new Error('OPENAI_CHATGPT_CREDENTIAL_KEY must be 32 bytes base64');
    }
    return key;
  }

  private async readCredentials(): Promise<StoredCredentials> {
    const envelope = JSON.parse(
      await readFile(this.credentialPath(), 'utf8'),
    ) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as StoredCredentials;
  }

  private async writeCredentials(
    credentials: StoredCredentials,
  ): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    const path = this.credentialPath();
    const temporary = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(
      temporary,
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64'),
      }),
      { mode: 0o600 },
    );
    await rename(temporary, path);
    await chmod(path, 0o600);
  }
}
