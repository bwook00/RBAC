const VECTOR_DIMENSIONS = 256
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu

export function embedSearchText(value: string): number[] {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0)
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) {
    return vector
  }

  for (const token of normalized.match(TOKEN_PATTERN) ?? []) {
    addFeature(vector, token, 2)
    for (const ngram of characterNgrams(token)) {
      addFeature(vector, ngram, 1)
    }
  }

  normalizeVector(vector)
  return vector
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let score = 0
  for (let index = 0; index < length; index += 1) {
    score += (left[index] ?? 0) * (right[index] ?? 0)
  }
  return score
}

function characterNgrams(value: string): string[] {
  if (value.length <= 3) {
    return [value]
  }
  const ngrams: string[] = []
  for (let index = 0; index <= value.length - 3; index += 1) {
    ngrams.push(value.slice(index, index + 3))
  }
  return ngrams
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const index = hashFeature(feature) % VECTOR_DIMENSIONS
  vector[index] = (vector[index] ?? 0) + weight
}

function normalizeVector(vector: number[]): void {
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  )
  if (magnitude === 0) {
    return
  }
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude
  }
}

function hashFeature(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
