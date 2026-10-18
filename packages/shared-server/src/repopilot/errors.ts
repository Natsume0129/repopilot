export class ResearchError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
