/**
 * React Native FormData polyfill accepts a `{ uri, name, type }` shape
 * (a "RN file") in addition to the standard Blob/File. Module augmentation
 * declares this overload so application code can pass RN files without an
 * `as unknown as Blob` cast.
 *
 * @see https://reactnative.dev/docs/network#formdata
 */

declare global {
  interface FormData {
    append(name: string, value: { uri: string; name: string; type: string }, fileName?: string): void;
  }
}

export {};
