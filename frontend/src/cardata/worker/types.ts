export type Command =
  | { type: 'hello' }
  | { type: 'request' }

export type CardataMessage = MessageEvent<{
  type: string;
  values?: Record<string, unknown>;
  timestamp?: number;
}>

export interface CARWorker
  extends Omit<Worker, 'postMessage' | 'onmessage'> {
  postMessage(message: Command, transfer?: Transferable[]): void
  onmessage: ((this: Worker, msg: CardataMessage) => any) | null
}