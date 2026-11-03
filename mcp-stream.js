// This channel only carries SSE comments. Tool calls still use POST sessions.
// Keeping it open also accommodates clients that retry unsupported GET streams.
export function createMcpEventStream(request, { heartbeatMs = 25000 } = {}) {
    const encoder = new TextEncoder()
    let timer, controller, closed = false
    const cleanup = (closeStream = true) => {
        if (closed) return
        closed = true
        clearInterval(timer)
        request.signal.removeEventListener('abort', onAbort)
        if (closeStream) controller.close()
    }
    const onAbort = () => cleanup()
    const stream = new ReadableStream({
        start(value) {
            controller = value
            if (request.signal.aborted) return cleanup()
            controller.enqueue(encoder.encode('retry: 60000\n: connected\n\n'))
            timer = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), heartbeatMs)
            request.signal.addEventListener('abort', onAbort, { once: true })
        },
        cancel() { cleanup(false) },
    })
    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
        },
    })
}
