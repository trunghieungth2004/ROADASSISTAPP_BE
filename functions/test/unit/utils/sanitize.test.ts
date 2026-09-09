import {sanitizeObject} from "../../../utils/sanitize";

const NUL = String.fromCharCode(0);
const US = String.fromCharCode(31);

describe("sanitizeObject", () => {
  it("trims strings", () => {
    expect(sanitizeObject({name: "  padded  "})).toEqual({name: "padded"});
  });

  it("strips control characters but keeps tab and newline", () => {
    expect(sanitizeObject({note: `a${NUL}b${US}c`})).toEqual({note: "abc"});
    expect(sanitizeObject({note: "a\tb\nc"})).toEqual({note: "a\tb\nc"});
  });

  it("passes non-objects through", () => {
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
    expect(sanitizeObject(42)).toBe(42);
  });

  it("recurses into arrays and nested objects", () => {
    expect(
      sanitizeObject({tags: ["  x  ", `y${NUL}`], deep: {v: "  z  "}}),
    ).toEqual({tags: ["x", "y"], deep: {v: "z"}});
  });
});
