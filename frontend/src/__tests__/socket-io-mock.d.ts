declare module 'socket.io-mock' {
  class SocketMock {
    socketClient: {
      on(event: string, callback: (...args: any[]) => void): void;
      emit(event: string, ...args: any[]): void;
    };
    emit(event: string, ...args: any[]): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }
  export default SocketMock;
}
