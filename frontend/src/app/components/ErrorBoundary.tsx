import React from 'react';
import styled from 'styled-components';
import { Typography } from '@/theme/styles/Typography';
import { Button } from '@/theme/styles/Inputs';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, componentStack: string) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const Fallback = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
  color: white;
`;

// Keeps a crashing view from unmounting the whole app (and with it CarPlay).
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info.componentStack ?? '');
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Fallback>
        <Typography.Display2>Something went wrong</Typography.Display2>
        <div>{this.state.error.message}</div>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Fallback>
    );
  }
}

export default ErrorBoundary;
