/** The host could not prove that a tool's child processes stopped. */
export class OneToolCleanupError extends Error {
  constructor() {
    super("One tool cleanup could not be confirmed");
    this.name = "OneToolCleanupError";
  }
}
