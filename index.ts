type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type ResponseType = 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';

interface AxiosseRequestConfig {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, string | number | boolean>;
  responseType?: ResponseType;
  timeout?: number;
  withCredentials?: boolean;
  signal?: AbortSignal;
}

interface AxiosseResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: AxiosseRequestConfig;
}

type InterceptorHandler<T> = (value: T) => T | Promise<T>;
type InterceptorErrorHandler = (error: any) => any;

class InterceptorManager<T> {
  private handlers: Array<{
    fulfilled?: InterceptorHandler<T>;
    rejected?: InterceptorErrorHandler;
  }> = [];

  use(fulfilled?: InterceptorHandler<T>, rejected?: InterceptorErrorHandler): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null as any;
    }
  }

  forEach(fn: (h: { fulfilled?: InterceptorHandler<T>; rejected?: InterceptorErrorHandler }) => void): void {
    this.handlers.forEach(handler => {
      if (handler) {
        fn(handler);
      }
    });
  }
}

export class Axiosse {
  private requestInterceptors = new InterceptorManager<AxiosseRequestConfig>();
  private responseInterceptors = new InterceptorManager<AxiosseResponse>();

  constructor() {}

  request<T = any>(config: AxiosseRequestConfig): Promise<AxiosseResponse<T>> {
    const { method = 'GET', url, headers = {}, data, params, responseType, timeout, withCredentials, signal } = config;
    
    // 构建URL参数
    let requestUrl = url;
    if (params) {
      const queryString = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      requestUrl += (url.includes('?') ? '&' : '?') + queryString;
    }

    // 构建请求配置
    const fetchConfig: RequestInit = {
      method,
      headers: new Headers(headers),
      credentials: withCredentials ? 'include' : 'same-origin',
      signal,
    };

    if (data) {
      if (typeof data === 'object' && !(data instanceof FormData)) {
        fetchConfig.headers.set('Content-Type', 'application/json');
        fetchConfig.body = JSON.stringify(data);
      } else {
        fetchConfig.body = data;
      }
    }

    // 应用请求拦截器
    const requestInterceptorChain: any[] = [];
    this.requestInterceptors.forEach(interceptor => {
      requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
    });

    // 应用响应拦截器
    const responseInterceptorChain: any[] = [];
    this.responseInterceptors.forEach(interceptor => {
      responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
    });

    // 构建请求链
    let promise = Promise.resolve({ ...config, url: requestUrl, fetchConfig });

    // 添加请求拦截器到链
    requestInterceptorChain.forEach(interceptor => {
      promise = promise.then(interceptor).catch(interceptor);
    });

    // 添加实际请求到链
    promise = promise.then(async (config: AxiosseRequestConfig & { fetchConfig: RequestInit }) => {
      try {
        const controller = new AbortController();
        const fetchSignal = config.signal || controller.signal;
        
        if (timeout) {
          setTimeout(() => controller.abort(), timeout);
        }

        const response = await fetch(config.url, { ...config.fetchConfig, signal: fetchSignal });
        
        let responseData;
        switch (responseType) {
          case 'arraybuffer':
            responseData = await response.arrayBuffer();
            break;
          case 'blob':
            responseData = await response.blob();
            break;
          case 'json':
            responseData = await response.json();
            break;
          case 'text':
            responseData = await response.text();
            break;
          case 'stream':
            responseData = response.body;
            break;
          default:
            responseData = await response.json();
        }

        return {
          data: responseData,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          config,
        };
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error(`Request aborted${timeout ? ' due to timeout' : ''}`);
        }
        throw error;
      }
    });

    // 添加响应拦截器到链
    responseInterceptorChain.forEach(interceptor => {
      promise = promise.then(interceptor).catch(interceptor);
    });

    return promise as Promise<AxiosseResponse<T>>;
  }

  // 流式响应处理方法
  stream<T = any>(config: AxiosseRequestConfig, callback: (chunk: T) => void): Promise<AxiosseResponse<T>> {
    config.responseType = 'stream';
    
    return this.request(config).then(async response => {
      if (!response.data) {
        return response;
      }

      const reader = (response.data as ReadableStream).getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        callback(chunk as unknown as T);
      }

      return response;
    });
  }

  // 生成器流式响应处理方法
  async *streamGenerator<T = any>(config: AxiosseRequestConfig): AsyncGenerator<T, void, unknown> {
    config.responseType = 'stream';
    
    const response = await this.request(config);
    if (!response.data) {
      return;
    }

    const reader = (response.data as ReadableStream).getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      
      const chunk = decoder.decode(value, { stream: true });
      yield chunk as unknown as T;
    }
  }

  // 快捷方法
  get<T = any>(url: string, config?: Omit<AxiosseRequestConfig, 'url' | 'method'>): Promise<AxiosseResponse<T>> {
    return this.request({ ...config, method: 'GET', url });
  }

  post<T = any>(url: string, data?: any, config?: Omit<AxiosseRequestConfig, 'url' | 'method' | 'data'>): Promise<AxiosseResponse<T>> {
    return this.request({ ...config, method: 'POST', url, data });
  }

  put<T = any>(url: string, data?: any, config?: Omit<AxiosseRequestConfig, 'url' | 'method' | 'data'>): Promise<AxiosseResponse<T>> {
    return this.request({ ...config, method: 'PUT', url, data });
  }

  delete<T = any>(url: string, config?: Omit<AxiosseRequestConfig, 'url' | 'method'>): Promise<AxiosseResponse<T>> {
    return this.request({ ...config, method: 'DELETE', url });
  }

  patch<T = any>(url: string, data?: any, config?: Omit<AxiosseRequestConfig, 'url' | 'method' | 'data'>): Promise<AxiosseResponse<T>> {
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  // 拦截器方法
  interceptors = {
    request: {
      use: (fulfilled?: InterceptorHandler<AxiosseRequestConfig>, rejected?: InterceptorErrorHandler) => 
        this.requestInterceptors.use(fulfilled, rejected),
      eject: (id: number) => this.requestInterceptors.eject(id),
    },
    response: {
      use: (fulfilled?: InterceptorHandler<AxiosseResponse>, rejected?: InterceptorErrorHandler) => 
        this.responseInterceptors.use(fulfilled, rejected),
      eject: (id: number) => this.responseInterceptors.eject(id),
    },
  };
}

// 默认导出单例
const axiosse = new Axiosse();
export default axiosse;  