import { AxiosRequestConfig } from 'index.d.ts';

type SSERequestConfig = AxiosRequestConfig & {
    onMessage?: (data: any, event: MessageEvent) => void;
    onError?: (error: any) => void;
};

type Interceptor<T> = (value: T) => T | Promise<T>;

class InterceptorManager<T> {
    private handlers: Interceptor<T>[] = [];
    use(fn: Interceptor<T>) {
        this.handlers.push(fn);
    }
    async run(value: T): Promise<T> {
        let v = value;
        for (const handler of this.handlers) {
            v = await handler(v);
        }
        return v;
    }
}

class SSEAxiosLike {
    interceptors = {
        request: new InterceptorManager<SSERequestConfig>(),
        response: new InterceptorManager<any>(),
    };

    constructor(private defaultConfig: SSERequestConfig = {}) {}

    create(config: SSERequestConfig = {}) {
        return new SSEAxiosLike({ ...this.defaultConfig, ...config });
    }

    async request<T = any>(config: SSERequestConfig): Promise<void> {
        const finalConfig = await this.interceptors.request.run({ ...this.defaultConfig, ...config });
        const { url, method = 'GET', headers = {}, params, onMessage, onError } = finalConfig;
        if (!url) throw new Error('URL is required');

        // Build query string for GET params
        let fullUrl = url;
        if (params && method.toUpperCase() === 'GET') {
            const qs = new URLSearchParams(params as any).toString();
            fullUrl += (url.includes('?') ? '&' : '?') + qs;
        }

        const es = new EventSource(fullUrl, { withCredentials: !!finalConfig.withCredentials });

        es.onmessage = async (event) => {
            let data: any = event.data;
            try {
                data = safeParseJSON(event.data, {});
            } catch {}
            const resp = await this.interceptors.response.run(data);
            onMessage?.(resp, event);
        };

        es.onerror = (err) => {
            es.close();
            onError?.(err);
        };
    }

    // Generator-based streaming
    async *stream<T = any>(config: SSERequestConfig): AsyncGenerator<T, void, unknown> {
        const finalConfig = await this.interceptors.request.run({ ...this.defaultConfig, ...config });
        const { url, method = 'GET', headers = {}, params } = finalConfig;
        if (!url) throw new Error('URL is required');

        let fullUrl = url;
        if (params && method.toUpperCase() === 'GET') {
            const qs = new URLSearchParams(params as any).toString();
            fullUrl += (url.includes('?') ? '&' : '?') + qs;
        }

        const es = new EventSource(fullUrl, { withCredentials: !!finalConfig.withCredentials });

        const queue: any[] = [];
        let done = false;

        es.onmessage = async (event) => {
            let data: any = event.data;
            try {
                data = safeParseJSON(event.data, {});
            } catch {}
            const resp = await this.interceptors.response.run(data);
            queue.push(resp);
        };

        es.onerror = (err) => {
            es.close();
            done = true;
        };

        while (!done || queue.length > 0) {
            if (queue.length > 0) {
                yield queue.shift();
            } else {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
    }

    // Shorthand
    get<T = any>(url: string, config?: SSERequestConfig) {
        return this.request<T>({ ...config, url, method: 'GET' });
    }
}

const sseAxios = new SSEAxiosLike();

export default sseAxios;
export { SSEAxiosLike };