import { DocumentTextQualityService } from './document-text-quality.service';

describe('DocumentTextQualityService', () => {
  const service = new DocumentTextQualityService();

  it('marks empty text as empty and requiring cloud recognition', () => {
    expect(service.evaluate('   ', 1)).toMatchObject({
      quality: 'empty',
      score: 0,
      requiresCloudRecognition: true,
    });
  });

  it('accepts normal Russian text', () => {
    const text =
      'Настоящий документ подтверждает право собственности на нежилое помещение. '.repeat(
        5,
      );

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'good',
      requiresCloudRecognition: false,
    });
  });

  it('accepts normal Kazakh text without treating Kazakh letters as errors', () => {
    const text =
      'Бұл құжат Қазақстан Республикасының заңнамасына сәйкес әзірленді және ұсынылды. '.repeat(
        5,
      );

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'good',
      requiresCloudRecognition: false,
    });
  });

  it('accepts mixed Russian and Kazakh text', () => {
    const text =
      'Документ содержит сведения об объекте. Құжатта мүлік туралы ақпарат берілген. '.repeat(
        5,
      );

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'good',
      requiresCloudRecognition: false,
    });
  });

  it('marks many single-character lines as poor', () => {
    const text = Array.from({ length: 80 }, (_, index) =>
      String.fromCharCode(0x430 + (index % 20)),
    ).join('\n');

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'poor',
      requiresCloudRecognition: true,
    });
    expect(service.evaluate(text, 1).reasons).toContain(
      'many-single-character-lines',
    );
  });

  it('marks damaged OCR tokens as poor', () => {
    const text = Array.from(
      { length: 50 },
      () => 'cy/-Ia ЛЪ2а-6 Туркестап',
    ).join(' ');

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'poor',
      requiresCloudRecognition: true,
    });
    expect(service.evaluate(text, 1).reasons).toContain(
      'many-short-damaged-tokens',
    );
  });

  it('marks mixed letter-number OCR artifacts as poor', () => {
    const text = Array.from(
      { length: 50 },
      () => 'K0Hcanmuæ Pecll 6JIH1€a A6aViC1<HIY1',
    ).join(' ');

    expect(service.evaluate(text, 1)).toMatchObject({
      quality: 'poor',
      requiresCloudRecognition: true,
    });
    expect(service.evaluate(text, 1).reasons).toContain(
      'many-suspicious-ocr-tokens',
    );
  });

  it('marks the damaged first-document OCR fragment as poor', () => {
    const text = Array.from(
      { length: 12 },
      () =>
        'CTopoHa закJIюченного cy/-Ia I\\4акаrпевой ЛЪ2а-6 }lb н€tходящееся Туркестап',
    ).join(' ');

    const result = service.evaluate(text, 1);

    expect(result).toMatchObject({
      quality: 'poor',
      requiresCloudRecognition: true,
    });
    expect(result.score).toBeLessThan(75);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'many-mixed-script-tokens',
        'many-symbols-inside-words',
      ]),
    );
    expect(result.metrics).toMatchObject({
      mixedScriptTokenRatio: expect.any(Number),
      symbolInsideWordRatio: expect.any(Number),
      suspiciousShortTokenRatio: expect.any(Number),
      fragmentedWordRatio: expect.any(Number),
    });
  });

  it('does not send a good document for cloud recognition', () => {
    const result = service.evaluate(
      'Договор купли-продажи имущества заключён в соответствии с законодательством. '.repeat(
        5,
      ),
      1,
    );

    expect(result.requiresCloudRecognition).toBe(false);
  });

  it('marks a poor document as requiring cloud recognition', () => {
    const result = service.evaluate('а\nб\nв\nг\nд\nе\nж\nз', 1);

    expect(result.quality).toBe('poor');
    expect(result.requiresCloudRecognition).toBe(true);
  });
});
