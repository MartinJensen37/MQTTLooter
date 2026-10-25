/**
 * Incremental reader for recording files: `{"recordingInfo": {...}, "messages": [{...}, ...]}`.
 * Each element of the top-level `messages` array is returned as soon as it is complete, so a
 * file of any size is read with bounded memory. Other top-level values are kept and parsed when
 * complete. Every captured value is limited to 1 MiB.
 */
const MAX_VALUE = 1024 * 1024;
const whitespace = (char: string) =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';

/** One JSON value's text, collected as slices of the fed chunks. */
class Capture {
  private parts: string[] = [];
  private length = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private readonly scalar: boolean;

  constructor(first: string) {
    this.scalar = first !== '{' && first !== '[' && first !== '"';
  }

  get text(): string {
    return this.parts.join('');
  }

  private keep(slice: string): void {
    this.length += slice.length;
    if (this.length > MAX_VALUE) throw new Error('A recording value exceeds 1 MiB');
    this.parts.push(slice);
  }

  /**
   * Scan from `start`. Returns the index just after the value, or -1 when the chunk ended first.
   * A scalar ends before the separator that follows it, which is left for the caller.
   */
  scan(text: string, start: number): number {
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (this.scalar) {
        if (char === ',' || char === '}' || char === ']' || whitespace(char)) {
          this.keep(text.slice(start, index));
          return index;
        }
        continue;
      }
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') {
          this.inString = false;
          if (this.depth === 0) {
            this.keep(text.slice(start, index + 1));
            return index + 1;
          }
        }
      } else if (char === '"') this.inString = true;
      else if (char === '{' || char === '[') this.depth++;
      else if (char === '}' || char === ']') {
        this.depth--;
        if (this.depth === 0) {
          this.keep(text.slice(start, index + 1));
          return index + 1;
        }
      }
    }
    this.keep(text.slice(start));
    return -1;
  }
}

type State = 'start' | 'key' | 'colon' | 'value' | 'comma' | 'end' | 'element' | 'after-element';

export class RecordingFileScanner {
  readonly fields: Record<string, unknown> = {};
  messages = 0;
  private state: State = 'start';
  private capture: Capture | null = null;
  private capturing: 'key' | 'value' | 'element' = 'value';
  private name = '';

  /** Feed decoded text; returns the message objects completed within it. */
  feed(text: string): unknown[] {
    const completed: unknown[] = [];
    let index = 0;
    while (index < text.length) {
      if (this.capture) {
        const next = this.capture.scan(text, index);
        if (next === -1) break;
        const parsed = JSON.parse(this.capture.text);
        this.capture = null;
        if (this.capturing === 'key') {
          this.name = parsed;
          this.state = 'colon';
        } else if (this.capturing === 'element') {
          completed.push(parsed);
          this.messages++;
          this.state = 'after-element';
        } else {
          this.fields[this.name] = parsed;
          this.state = 'comma';
        }
        index = next;
        continue;
      }
      const char = text[index];
      if (whitespace(char)) {
        index++;
        continue;
      }
      const begin = (kind: 'key' | 'value' | 'element') => {
        this.capture = new Capture(char);
        this.capturing = kind;
      };
      switch (this.state) {
        case 'start':
          if (char !== '{') throw new Error('A recording file must contain one JSON object');
          this.state = 'key';
          break;
        case 'key':
          if (char === '}' && !Object.keys(this.fields).length && !this.messages)
            this.state = 'end';
          else if (char === '"') begin('key');
          else throw new Error('Invalid recording file');
          break;
        case 'colon':
          if (char !== ':') throw new Error('Invalid recording file');
          this.state = 'value';
          break;
        case 'value':
          if (this.name === 'messages' && char === '[') this.state = 'element';
          else begin('value');
          break;
        case 'element':
        case 'after-element':
          if (char === ']') this.state = 'comma';
          else if (this.state === 'after-element' && char === ',') this.state = 'element';
          else if (this.state === 'element' && char === '{') begin('element');
          else throw new Error('Recorded messages must be a list of objects');
          break;
        case 'comma':
          if (char === ',') this.state = 'key';
          else if (char === '}') this.state = 'end';
          else throw new Error('Invalid recording file');
          break;
        case 'end':
          throw new Error('Unexpected text after the recording');
      }
      // A started capture includes this character; it is rescanned by the capture itself.
      if (!this.capture) index++;
    }
    return completed;
  }

  /** Call after the last chunk; throws if the file ended early. */
  end(): void {
    if (this.state !== 'end') throw new Error('The recording file ended unexpectedly');
  }
}
