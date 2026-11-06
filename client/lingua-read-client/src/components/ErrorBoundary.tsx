import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; title?: string };

/** Contains render/lifecycle failures without discarding the surrounding navigation. */
export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unable to render this view:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="alert alert-danger m-3">
        <h2>{this.props.title || 'Something went wrong'}</h2>
        <p>Please try again or reload the page.</p>
        <button type="button" className="btn btn-primary me-2" onClick={() => this.setState({ failed: false })}>Try again</button>
        <button type="button" className="btn btn-outline-secondary me-2" onClick={() => window.location.reload()}>Reload page</button>
        <a href="/" className="btn btn-link">Return home</a>
      </div>
    );
  }
}
