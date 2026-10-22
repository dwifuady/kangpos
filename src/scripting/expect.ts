// A small chai-style `expect` covering what Postman scripts commonly use:
// pm.expect(x).to.equal(1), .to.be.true, .to.have.property('id'), .not ...

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function inspect(value: unknown): string {
  if (typeof value === 'string') return `'${value.length > 80 ? `${value.slice(0, 77)}...` : value}'`;
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return '[Function]';
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return String(value);
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** `include`: substring, array element (deep), or object subset. */
function includes(container: unknown, needle: unknown): boolean {
  if (typeof container === 'string') return container.includes(String(needle));
  if (Array.isArray(container)) return container.some(item => deepEqual(item, needle));
  if (container && typeof container === 'object' && needle && typeof needle === 'object') {
    return Object.entries(needle).every(([k, v]) => deepEqual((container as Record<string, unknown>)[k], v));
  }
  return false;
}

export class Assertion {
  private negated = false;

  constructor(private readonly actual: unknown, private readonly label = '') {}

  private check(pass: boolean, message: string, negatedMessage: string): this {
    if (pass === this.negated) {
      throw new AssertionError(`${this.label ? `${this.label}: ` : ''}${this.negated ? negatedMessage : message}`);
    }
    return this;
  }

  // Language chains (no-ops), as in chai.
  get to() { return this; }
  get be() { return this; }
  get been() { return this; }
  get is() { return this; }
  get that() { return this; }
  get which() { return this; }
  get and() { return this; }
  get has() { return this; }
  get have() { return this; }
  get with() { return this; }
  get at() { return this; }
  get of() { return this; }
  get same() { return this; }
  get does() { return this; }
  get deep() { return this; }
  get not() {
    this.negated = !this.negated;
    return this;
  }

  // Property assertions.
  get true() { return this.check(this.actual === true, `expected ${inspect(this.actual)} to be true`, 'expected value not to be true'); }
  get false() { return this.check(this.actual === false, `expected ${inspect(this.actual)} to be false`, 'expected value not to be false'); }
  get null() { return this.check(this.actual === null, `expected ${inspect(this.actual)} to be null`, 'expected value not to be null'); }
  get undefined() { return this.check(this.actual === undefined, `expected ${inspect(this.actual)} to be undefined`, 'expected value not to be undefined'); }
  get NaN() { return this.check(Number.isNaN(this.actual), `expected ${inspect(this.actual)} to be NaN`, 'expected value not to be NaN'); }
  get ok() { return this.check(!!this.actual, `expected ${inspect(this.actual)} to be truthy`, `expected ${inspect(this.actual)} to be falsy`); }
  get exist() { return this.check(this.actual !== null && this.actual !== undefined, 'expected value to exist', `expected ${inspect(this.actual)} not to exist`); }
  get empty() {
    const a = this.actual;
    const empty =
      typeof a === 'string' || Array.isArray(a) ? a.length === 0 : a && typeof a === 'object' ? Object.keys(a).length === 0 : false;
    return this.check(empty, `expected ${inspect(a)} to be empty`, `expected ${inspect(a)} not to be empty`);
  }

  equal(expected: unknown) {
    return this.check(Object.is(this.actual, expected), `expected ${inspect(this.actual)} to equal ${inspect(expected)}`, `expected ${inspect(this.actual)} not to equal ${inspect(expected)}`);
  }
  equals(expected: unknown) { return this.equal(expected); }
  eq(expected: unknown) { return this.equal(expected); }

  eql(expected: unknown) {
    return this.check(deepEqual(this.actual, expected), `expected ${inspect(this.actual)} to deeply equal ${inspect(expected)}`, `expected ${inspect(this.actual)} not to deeply equal ${inspect(expected)}`);
  }

  a(type: string) {
    const actualType = typeName(this.actual);
    return this.check(actualType === type.toLowerCase(), `expected ${inspect(this.actual)} to be a ${type} (got ${actualType})`, `expected ${inspect(this.actual)} not to be a ${type}`);
  }
  an(type: string) { return this.a(type); }

  include(needle: unknown) {
    return this.check(includes(this.actual, needle), `expected ${inspect(this.actual)} to include ${inspect(needle)}`, `expected ${inspect(this.actual)} not to include ${inspect(needle)}`);
  }
  includes(needle: unknown) { return this.include(needle); }
  contain(needle: unknown) { return this.include(needle); }
  contains(needle: unknown) { return this.include(needle); }

  property(name: string, ...value: unknown[]) {
    const obj = this.actual as Record<string, unknown> | null | undefined;
    const has = obj !== null && obj !== undefined && typeof obj === 'object' && name in obj;
    if (value.length === 0 || !has) {
      return this.check(has, `expected ${inspect(obj)} to have property '${name}'`, `expected ${inspect(obj)} not to have property '${name}'`);
    }
    const actual = obj![name];
    return this.check(deepEqual(actual, value[0]), `expected property '${name}' to equal ${inspect(value[0])} (got ${inspect(actual)})`, `expected property '${name}' not to equal ${inspect(value[0])}`);
  }

  keys(...names: (string | string[])[]) {
    const wanted = names.flat();
    const obj = this.actual && typeof this.actual === 'object' ? Object.keys(this.actual) : [];
    return this.check(wanted.every(k => obj.includes(k)), `expected ${inspect(this.actual)} to have keys ${inspect(wanted)}`, `expected ${inspect(this.actual)} not to have keys ${inspect(wanted)}`);
  }

  lengthOf(n: number) {
    const len = (this.actual as { length?: number } | null)?.length;
    return this.check(len === n, `expected ${inspect(this.actual)} to have length ${n} (got ${len})`, `expected length not to be ${n}`);
  }
  length(n: number) { return this.lengthOf(n); }

  above(n: number) { return this.check(Number(this.actual) > n, `expected ${inspect(this.actual)} to be above ${n}`, `expected ${inspect(this.actual)} not to be above ${n}`); }
  gt(n: number) { return this.above(n); }
  greaterThan(n: number) { return this.above(n); }
  below(n: number) { return this.check(Number(this.actual) < n, `expected ${inspect(this.actual)} to be below ${n}`, `expected ${inspect(this.actual)} not to be below ${n}`); }
  lt(n: number) { return this.below(n); }
  lessThan(n: number) { return this.below(n); }
  least(n: number) { return this.check(Number(this.actual) >= n, `expected ${inspect(this.actual)} to be at least ${n}`, `expected ${inspect(this.actual)} to be below ${n}`); }
  gte(n: number) { return this.least(n); }
  most(n: number) { return this.check(Number(this.actual) <= n, `expected ${inspect(this.actual)} to be at most ${n}`, `expected ${inspect(this.actual)} to be above ${n}`); }
  lte(n: number) { return this.most(n); }
  within(lo: number, hi: number) {
    const v = Number(this.actual);
    return this.check(v >= lo && v <= hi, `expected ${inspect(this.actual)} to be within ${lo}..${hi}`, `expected ${inspect(this.actual)} not to be within ${lo}..${hi}`);
  }

  match(re: RegExp) {
    return this.check(re.test(String(this.actual)), `expected ${inspect(this.actual)} to match ${re}`, `expected ${inspect(this.actual)} not to match ${re}`);
  }

  oneOf(list: unknown[]) {
    return this.check(list.some(v => deepEqual(v, this.actual)), `expected ${inspect(this.actual)} to be one of ${inspect(list)}`, `expected ${inspect(this.actual)} not to be one of ${inspect(list)}`);
  }
}

export function expect(actual: unknown, label?: string): Assertion {
  return new Assertion(actual, label);
}

expect.fail = (message = 'expect.fail()') => {
  throw new AssertionError(message);
};
