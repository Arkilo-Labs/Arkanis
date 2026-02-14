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
            <div className="min-h-screen flex items-center justify-center px-4 py-12">
                <div className="glass-card w-full max-w-2xl p-8">
                    <span className="text-subtitle-en mb-2 block">Runtime error</span>
                    <h1 className="text-hero-cn text-apple-gradient">页面发生异常</h1>
                    <p className="text-sm text-white/60 mt-3 font-mono break-all">
                        {message}
                    </p>
                    <div className="mt-6 flex gap-3">
                        <button
                            type="button"
                            className="btn-glass h-12 px-5"
                            onClick={() => window.location.reload()}
                        >
                            <i className="fas fa-rotate-right"></i>
                            <span className="font-bold">刷新页面</span>
                        </button>
                        <button
                            type="button"
                            className="btn-glass-secondary h-12 px-5"
                            onClick={() => this.setState({ error: null })}
                        >
                            <i className="fas fa-xmark"></i>
                            <span className="font-semibold">继续运行</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

