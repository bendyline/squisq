/**
 * The model transport the authoring protocols share.
 *
 * Squisq owns what a model is asked and how its replies are judged (slide
 * wording, study cards); a host only makes the call. One host function of
 * this shape serves every protocol: each request carries its system prompt,
 * user message, reply format and limits, and `kind` says which protocol and
 * step it is for.
 */

/** A reply shape for hosts that can enforce structured output (a JSON schema). */
export interface AuthorModelFormat {
  /** A stable name, letters, digits, `_` and `-`. */
  name: string;
  schema: Record<string, unknown>;
}

/** One request to the model, in terms any chat API can carry. */
export interface AuthorModelRequest {
  /** Which protocol and step the request is for, e.g. `slide`, `flashcards`. */
  kind: string;
  /** The system prompt. */
  system: string;
  /** The request itself, as the user message. */
  user: string;
  /** The reply shape, for a host that can enforce structured output. */
  responseFormat: AuthorModelFormat;
  /** Output tokens the reply may use. */
  maxTokens: number;
  temperature: number;
}

/** The model's reply. `truncated` when it stopped at `maxTokens`. */
export interface AuthorModelReply {
  text: string;
  truncated?: boolean;
}

/**
 * Sends one request and resolves with the reply. Throw to report a failure;
 * honor `signal`.
 */
export type AuthorModel<Request extends AuthorModelRequest = AuthorModelRequest> = (
  request: Request,
  signal?: AbortSignal,
) => Promise<AuthorModelReply>;

/** One request; an abort while it was out is reported as the abort, not as its failure. */
export async function askAuthorModel<Request extends AuthorModelRequest>(
  model: AuthorModel<Request>,
  request: Request,
  signal: AbortSignal | undefined,
): Promise<AuthorModelReply> {
  signal?.throwIfAborted();
  try {
    const reply = await model(request, signal);
    signal?.throwIfAborted();
    return reply;
  } catch (error: unknown) {
    signal?.throwIfAborted();
    throw error;
  }
}
