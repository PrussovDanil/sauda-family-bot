import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { ChatGptAuthService } from './chatgpt-auth.service';

async function main(): Promise<void> {
  const service = new ChatGptAuthService(new ConfigService(process.env));
  const result = await service.signIn();
  if (!result.sharing) {
    throw new Error('ChatGPT plan usage permission was not granted');
  }
  console.log('Sign in with ChatGPT completed successfully.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Sign-in failed');
  process.exitCode = 1;
});
