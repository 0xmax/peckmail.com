const BIRDS = [
  "robin", "wren", "finch", "sparrow", "dove", "lark", "swift", "heron",
  "crane", "piper", "plover", "falcon", "osprey", "kestrel", "merlin",
  "oriole", "cedar", "tanager", "vireo", "pipit", "dunlin", "avocet",
  "curlew", "thrush", "dipper", "grouse", "petrel", "tern", "shrike",
  "linnet",
];

const NATURE = [
  "meadow", "brook", "willow", "cedar", "aspen", "maple", "birch", "holly",
  "fern", "moss", "sage", "thyme", "laurel", "ivy", "clover", "hazel",
  "amber", "coral", "pearl", "frost", "mist", "dew", "glen", "vale",
  "cove", "ridge", "dale", "heath", "marsh", "briar",
];

const DOMAIN = "inbox.peckmail.com";

export function generateEmailAddress(): string {
  const bird = BIRDS[Math.floor(Math.random() * BIRDS.length)];
  const nature = NATURE[Math.floor(Math.random() * NATURE.length)];
  const num = Math.floor(Math.random() * 100);
  return `${bird}-${nature}-${num}@${DOMAIN}`;
}
