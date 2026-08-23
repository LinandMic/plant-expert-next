import { Component } from "react";

// Temporary error boundary (spec: "Add production home render
// diagnostics") wrapping ONLY AccueilDashboard in pages/index.js. If
// AccueilDashboard throws during render, this is what stops the zone from
// silently going blank: in normal mode it shows a neutral, non-technical
// fallback; with ?homeDebug=1 it also shows the error name/message and
// component stack (never a secret — these are plain JS runtime error
// strings, not user data).
export default class HomeDashboardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error("AccueilDashboard render error", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      if (this.props.homeDebug) {
        return (
          <div className="home-debug-error">
            <div className="home-debug-title">HOME DASHBOARD ERROR</div>
            <div>error name: {this.state.error.name}</div>
            <div>error message: {this.state.error.message}</div>
            {this.state.errorInfo && this.state.errorInfo.componentStack && (
              <pre className="home-debug-stack">{this.state.errorInfo.componentStack}</pre>
            )}
          </div>
        );
      }
      return (
        <div
          className="home-debug-fallback"
          style={{ background: "#faf5e9", color: "#6b4f1e", fontFamily: "sans-serif", fontSize: 13, padding: "14px 16px", borderRadius: 8, margin: "8px 0" }}
        >
          Le tableau de bord est temporairement indisponible. Réessayez dans un instant.
        </div>
      );
    }
    return this.props.children;
  }
}
