import { expect, it } from 'vitest';
import { plainLog, prettyPayload } from '../src/renderer/src/utils/payloadPresentation';

it('formats JSON without changing numeric lexemes, strings or duplicate keys', () => {
  const value =
    '{"large":9007199254740993,"v":1e-9,"v":-0,"text":"a \\"quote\\" \\n","empty":[],"nested":[{},[true,null]]}';
  const result = prettyPayload(value, 'utf8');
  expect(result.notice).toBeUndefined();
  expect(result.text).toContain('9007199254740993');
  expect(result.text).toContain('1e-9');
  expect(result.text).toContain('"v": -0');
  expect(result.text).toContain('\n  "large":');
  expect(JSON.parse(result.text!)).toEqual(JSON.parse(value));
  expect(prettyPayload('null', 'utf8').text).toBe('null');
});

it('bounds JSON formatting and reports invalid or binary payloads without substituting data', () => {
  expect(prettyPayload('{bad}', 'utf8').notice).toContain('not valid JSON');
  expect(prettyPayload('AP8=', 'base64').notice).toContain('UTF-8');
  expect(prettyPayload(' '.repeat(65537), 'utf8').notice).toContain('limited');
  expect(prettyPayload('['.repeat(40) + '0' + ']'.repeat(40), 'utf8').notice).toContain('complex');
  const formatted = prettyPayload(JSON.stringify(Array.from({ length: 9000 }, () => 1234)), 'utf8');
  expect(formatted.text!.length).toBeLessThanOrEqual(65536);
  expect(formatted.notice).toContain('truncated');
});

it('keeps plain log previews bounded and labels binary values', () => {
  const messages = [
    { id: 'a', topic: 'a\nb', message: 'AP8=', encoding: 'base64' as const, timestamp: 0 },
    ...Array.from({ length: 300 }, (_, i) => ({
      id: String(i),
      topic: 'large',
      message: 'x'.repeat(10000),
      timestamp: 0,
    })),
  ];
  const log = plainLog(messages);
  expect(log.rows[0].text).toContain('"a\\nb" [base64] AP8=');
  expect(log.rows.map((row) => row.text).join('\n').length).toBeLessThanOrEqual(262144);
  expect(log.truncated).toBe(true);
  expect(messages[1].message).toHaveLength(10000);
});
