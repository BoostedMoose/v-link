export type Command =
  | { type: 'hello' }

export interface CARWorker
  extends Omit<Worker, 'postMessage' | 'onmessage'> {
  postMessage(message: Command, transfer?: Transferable[]): void
  onmessage: ((this: Worker, msg: CardataMessage) => any) | null
}