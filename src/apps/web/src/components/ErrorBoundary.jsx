import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('UI 崩溃:', error, info);
    }

    render() {
        if (!this.state.error) return this.props.children;

        const message = this.state.error?.message || String(this.state.error);

        return (
            <div className="auth-page">
                <div className="card p-8 w-full max-w-2xl">
                    <div className="text-xs tracking-wide text-text-muted">
                        Runtime error
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold mt-2">
                        页面发生异常
                    </h1>
                    <p className="text-sm text-text-muted mt-3 font-mono break-all">
                        {message}
                    </p>
                    <div className="mt-6 flex gap-3">
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => window.location.reload()}
                        >
                            <i className="fas fa-rotate-right"></i>
                            刷新页面
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => this.setState({ error: null })}
                        >
                            <i className="fas fa-xmark"></i>
                            继续运行
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
