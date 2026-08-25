// Minimal surface of libmime (no bundled types): only what sync-service
// uses to decode RFC 2047 encoded-words in subject headers (kurir-ios#59).
declare module "libmime" {
  const libmime: {
    decodeWords(value: string): string;
  };
  export default libmime;
}
