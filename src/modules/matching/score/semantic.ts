/**
 * Semantic similarity (10.9, D11): embeddings are off for MVP. The provider
 * interface is reserved; NoopSemanticProvider reports the component unused.
 */
export interface SemanticProvider {
  similarity(a: string, b: string): Promise<number | null>;
}

export class NoopSemanticProvider implements SemanticProvider {
  similarity(): Promise<number | null> {
    return Promise.resolve(null);
  }
}
