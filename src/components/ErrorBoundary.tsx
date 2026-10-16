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
        <div className="p-6 my-4 bg-white border border-red-200 rounded-3xl text-center space-y-3 shadow-xs">
          <div className="w-10 h-10 mx-auto rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-lg border border-red-100">
            ⚠️
          </div>
          <h3 className="text-sm font-bold text-slate-900">
            {this.props.fallbackTitle || 'Something went wrong displaying this section'}
          </h3>
          <p className="text-xs text-slate-500">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            className="px-4 py-2 bg-[#0088cc] hover:bg-[#0077b5] text-white rounded-xl text-xs font-bold transition shadow-2xs"
          >
            Reload Section
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
