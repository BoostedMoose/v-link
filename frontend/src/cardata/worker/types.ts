export type Command =
  | { type: 'hello' }
  | { type: 'request' }

export type CardataMessage = MessageEvent<{
  type: string;
  data?: Record<string, unknown>;
  polling?: Record<string, number>;
  timestamp?: string;
}>

export interface CARWorker
  extends Omit<Worker, 'postMessage' | 'onmessage'> {
  postMessage(message: Command, transfer?: Transferable[]): void
  onmessage: ((this: Worker, msg: CardataMessage) => any) | null
}
