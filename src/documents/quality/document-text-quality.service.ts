import { Injectable } from '@nestjs/common';
import type { TextQualityResult } from '../models/text-quality-result';

const GOOD_QUALITY_SCORE = 75;
const MIN_TEXT_LENGTH_FOR_CONFIDENT_CLASSIFICATION = 40;
const MIN_CHARACTERS_PER_PAGE = 80;
const MAX_REPLACEMENT_CHARACTER_RATIO = 0.01;
const MAX_CONTROL_CHARACTER_RATIO = 0.01;
const MAX_SINGLE_CHARACTER_LINE_RATIO = 0.3;
const MIN_READABLE_WORD_RATIO = 0.45;
const MAX_SPECIAL_CHARACTER_RATIO = 0.15;
const MAX_SHORT_DAMAGED_TOKEN_RATIO = 0.25;
const MAX_SUSPICIOUS_OCR_TOKEN_RATIO = 0.12;
const MAX_MIXED_SCRIPT_TOKEN_RATIO = 0.02;
const MAX_SYMBOL_INSIDE_WORD_RATIO = 0.03;
const MAX_FRAGMENTED_WORD_RATIO = 0.08;

const LOW_TEXT_DEDUCTION = 20;
const LOW_DENSITY_DEDUCTION = 30;
const REPLACEMENT_CHARACTER_DEDUCTION = 45;
const CONTROL_CHARACTER_DEDUCTION = 45;
const SINGLE_CHARACTER_LINE_DEDUCTION = 45;
const UNREADABLE_WORD_DEDUCTION = 30;
const SPECIAL_CHARACTER_DEDUCTION = 25;
const DAMAGED_TOKEN_DEDUCTION = 35;
const SUSPICIOUS_OCR_TOKEN_DEDUCTION = 35;
const MIXED_SCRIPT_TOKEN_DEDUCTION = 40;
const SYMBOL_INSIDE_WORD_DEDUCTION = 30;
const FRAGMENTED_WORD_DEDUCTION = 30;

@Injectable()
export class DocumentTextQualityService {
  evaluate(text: string, pageCount?: number): TextQualityResult {
    const trimmedText = text.trim();
    const metrics = this.getMetrics(trimmedText, pageCount);

    if (!trimmedText) {
      return {
        quality: 'empty',
        score: 0,
        reasons: ['text-is-empty'],
        requiresCloudRecognition: true,
        metrics,
      };
    }

    if (
      pageCount === undefined &&
      metrics.textLength < MIN_TEXT_LENGTH_FOR_CONFIDENT_CLASSIFICATION
    ) {
      return {
        quality: 'unknown',
        score: 50,
        reasons: ['insufficient-text-without-page-count'],
        requiresCloudRecognition: true,
        metrics,
      };
    }

    let score = 100;
    const reasons: string[] = [];
    const specialCharacterRatio = this.getSpecialCharacterRatio(trimmedText);

    if (metrics.textLength < MIN_TEXT_LENGTH_FOR_CONFIDENT_CLASSIFICATION) {
      score -= LOW_TEXT_DEDUCTION;
      reasons.push('text-is-too-short');
    }
    if (
      metrics.charactersPerPage !== undefined &&
      metrics.charactersPerPage < MIN_CHARACTERS_PER_PAGE
    ) {
      score -= LOW_DENSITY_DEDUCTION;
      reasons.push('low-characters-per-page');
    }
    if (metrics.replacementCharacterRatio > MAX_REPLACEMENT_CHARACTER_RATIO) {
      score -= REPLACEMENT_CHARACTER_DEDUCTION;
      reasons.push('replacement-characters-detected');
    }
    if (metrics.controlCharacterRatio > MAX_CONTROL_CHARACTER_RATIO) {
      score -= CONTROL_CHARACTER_DEDUCTION;
      reasons.push('control-characters-detected');
    }
    if (metrics.singleCharacterLineRatio > MAX_SINGLE_CHARACTER_LINE_RATIO) {
      score -= SINGLE_CHARACTER_LINE_DEDUCTION;
      reasons.push('many-single-character-lines');
    }
    if (metrics.readableWordRatio < MIN_READABLE_WORD_RATIO) {
      score -= UNREADABLE_WORD_DEDUCTION;
      reasons.push('low-readable-word-ratio');
    }
    if (specialCharacterRatio > MAX_SPECIAL_CHARACTER_RATIO) {
      score -= SPECIAL_CHARACTER_DEDUCTION;
      reasons.push('many-special-characters');
    }
    if (metrics.suspiciousShortTokenRatio > MAX_SHORT_DAMAGED_TOKEN_RATIO) {
      score -= DAMAGED_TOKEN_DEDUCTION;
      reasons.push('many-short-damaged-tokens');
    }
    if (metrics.suspiciousShortTokenRatio > MAX_SUSPICIOUS_OCR_TOKEN_RATIO) {
      score -= SUSPICIOUS_OCR_TOKEN_DEDUCTION;
      reasons.push('many-suspicious-ocr-tokens');
    }
    if (metrics.mixedScriptTokenRatio > MAX_MIXED_SCRIPT_TOKEN_RATIO) {
      score -= MIXED_SCRIPT_TOKEN_DEDUCTION;
      reasons.push('many-mixed-script-tokens');
    }
    if (metrics.symbolInsideWordRatio > MAX_SYMBOL_INSIDE_WORD_RATIO) {
      score -= SYMBOL_INSIDE_WORD_DEDUCTION;
      reasons.push('many-symbols-inside-words');
    }
    if (metrics.fragmentedWordRatio > MAX_FRAGMENTED_WORD_RATIO) {
      score -= FRAGMENTED_WORD_DEDUCTION;
      reasons.push('fragmented-ocr-text');
    }

    score = Math.max(1, score);
    const quality = score >= GOOD_QUALITY_SCORE ? 'good' : 'poor';

    return {
      quality,
      score,
      reasons,
      requiresCloudRecognition: quality === 'poor',
      metrics,
    };
  }

  private getMetrics(
    text: string,
    pageCount: number | undefined,
  ): TextQualityResult['metrics'] {
    const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim());
    const tokens = text.split(/\s+/).filter(Boolean);
    const wordTokens = tokens.filter(
      (token) => /\p{L}/u.test(token) && !this.isProtectedIdentifier(token),
    );
    const textLength = text.length;

    return {
      textLength,
      ...(pageCount && pageCount > 0
        ? { charactersPerPage: textLength / pageCount }
        : {}),
      replacementCharacterRatio: this.getCharacterRatio(text, /\uFFFD/g),
      controlCharacterRatio: this.getCharacterRatio(
        text,
        // oxlint-disable-next-line no-control-regex -- this metric detects damaged PDF text.
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
      ),
      singleCharacterLineRatio: nonEmptyLines.length
        ? nonEmptyLines.filter((line) => [...line.trim()].length <= 2).length /
          nonEmptyLines.length
        : 0,
      readableWordRatio: tokens.length
        ? tokens.filter((token) => /\p{L}/u.test(token)).length / tokens.length
        : 0,
      mixedScriptTokenRatio: this.getTokenRatio(
        wordTokens,
        (token) =>
          /\p{Script=Cyrillic}/u.test(token) && /\p{Script=Latin}/u.test(token),
      ),
      symbolInsideWordRatio: this.getTokenRatio(wordTokens, (token) =>
        /\p{L}[^\p{L}\s'’\-–—]+\p{L}/u.test(token),
      ),
      suspiciousShortTokenRatio: this.getTokenRatio(
        wordTokens,
        (token) =>
          [...token].length <= 8 &&
          (/[\\/{}\[\]]/.test(token) ||
            /\p{L}\d|\d\p{L}/u.test(token) ||
            /[<>€ØÆ]/u.test(token)),
      ),
      fragmentedWordRatio: this.getFragmentedWordRatio(text),
    };
  }

  private getCharacterRatio(value: string, pattern: RegExp): number {
    return value ? (value.match(pattern)?.length ?? 0) / value.length : 0;
  }

  private getSpecialCharacterRatio(value: string): number {
    const nonWhitespaceCharacters = value.replace(/\s/g, '');
    return nonWhitespaceCharacters
      ? (nonWhitespaceCharacters.match(/[^\p{L}\p{N}.,;:!?()«»"'’\-–—]/gu)
          ?.length ?? 0) / nonWhitespaceCharacters.length
      : 0;
  }

  private getTokenRatio(
    tokens: string[],
    predicate: (token: string) => boolean,
  ): number {
    return tokens.length ? tokens.filter(predicate).length / tokens.length : 0;
  }

  private getFragmentedWordRatio(text: string): number {
    const sentences = text.split(/[.!?…]+/u);
    let wordCount = 0;
    let fragmentedWordCount = 0;

    for (const sentence of sentences) {
      const words = sentence.match(/\p{L}+/gu) ?? [];
      wordCount += words.length;
      fragmentedWordCount += words.filter((word, index) => {
        if ([...word].length > 2) {
          return false;
        }

        return Boolean(
          (words[index - 1] && [...words[index - 1]].length <= 2) ||
          (words[index + 1] && [...words[index + 1]].length <= 2),
        );
      }).length;
    }

    return wordCount ? fragmentedWordCount / wordCount : 0;
  }

  private isProtectedIdentifier(token: string): boolean {
    const value = token.replace(/^[('"«]+|[)'"».,;:!?]+$/g, '');

    return (
      /^(?:https?:\/\/|www\.)/iu.test(value) ||
      /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u.test(value) ||
      /^\d{10}(?:\d{2})?$/u.test(value) ||
      /^\d+(?::\d+){2,}$/u.test(value) ||
      /^(?:№|no\.?)[\s-]*[\p{L}\d][\p{L}\d./-]*$/iu.test(value)
    );
  }
}
