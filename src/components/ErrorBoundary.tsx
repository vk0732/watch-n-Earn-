import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-4 bg-slate-900 border border-red-500/30 rounded-2xl text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center text-lg">
            ⚠️
          </div>
          <h3 className="text-sm font-bold text-white">
            {this.props.fallbackTitle || 'Something went wrong displaying this section'}
          </h3>
          <p className="text-xs text-slate-400">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition"
          >
            Reload Section
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
