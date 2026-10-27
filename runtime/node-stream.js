/** stream 的最小实现：够 fs 流、child_process 和常见插件用 */
;(() => {
  const EventEmitter = __node.events

  class Stream extends EventEmitter {
    pipe(dest, opts) {
      this.on("data", c => dest.write(c))
      if (opts?.end !== false) this.on("end", () => dest.end?.())
      this.resume?.()
      return dest
    }
  }

  class Readable extends Stream {
    constructor(opts = {}) {
      super()
      this._buf = []
      this.readable = true
      this.readableEncoding = opts.encoding || null
      this.readableObjectMode = !!opts.objectMode
      if (opts.read) this._read = opts.read
      if (opts.destroy) this._destroy = opts.destroy
    }
    static from(iter, opts) {
      const r = new Readable(opts)
      if (typeof iter === "string" || Buffer.isBuffer(iter)) iter = [iter]
      ;(async () => {
        try {
          for await (const c of iter) r.push(c)
          r.push(null)
        } catch (err) {
          r.destroy(err)
        }
      })()
      return r
    }
    push(chunk) {
      if (chunk === null) {
        this._ended = true
      } else {
        this._buf.push(chunk)
      }
      this._flow()
      return true
    }
    unshift(chunk) {
      this._buf.unshift(chunk)
    }
    _enc(c) {
      return this.readableEncoding && Buffer.isBuffer(c) ? c.toString(this.readableEncoding) : c
    }
    _flow() {
      if (!this._flowing) return
      while (this._buf.length && this._flowing) this.emit("data", this._enc(this._buf.shift()))
      if (this._ended && !this._buf.length && !this._endEmitted) {
        this._endEmitted = true
        this.readableEnded = true
        queueMicrotask(() => {
          this.emit("end")
          this.emit("close")
        })
      }
    }
    on(name, fn) {
      super.on(name, fn)
      if (name === "data" && !this._flowing && !this._paused) this.resume()
      return this
    }
    resume() {
      this._paused = false
      if (this._flowing) return this
      this._flowing = true
      queueMicrotask(() => {
        this._read?.()
        this._flow()
      })
      return this
    }
    pause() {
      this._flowing = false
      this._paused = true
      return this
    }
    isPaused() {
      return !this._flowing
    }
    read() {
      return this._buf.length ? this._enc(this._buf.shift()) : null
    }
    setEncoding(enc) {
      this.readableEncoding = enc
      return this
    }
    destroy(err) {
      if (this.destroyed) return this
      this.destroyed = true
      this._destroy?.(err, () => {})
      queueMicrotask(() => {
        if (err) this.emit("error", err)
        this.emit("close")
      })
      return this
    }
    [Symbol.asyncIterator]() {
      const q = [], w = []
      let done = false, error
      this.on("data", c => (w.length ? w.shift().resolve({ value: c, done: false }) : q.push(c)))
      this.on("end", () => {
        done = true
        while (w.length) w.shift().resolve({ value: undefined, done: true })
      })
      this.on("error", e => {
        error = e
        while (w.length) w.shift().reject(e)
      })
      return {
        next: () =>
          q.length ? Promise.resolve({ value: q.shift(), done: false })
          : done ? Promise.resolve({ value: undefined, done: true })
          : error ? Promise.reject(error)
          : new Promise((resolve, reject) => w.push({ resolve, reject })),
        return: async () => ({ value: undefined, done: true }),
        [Symbol.asyncIterator]() {
          return this
        },
      }
    }
  }

  const writableMethods = {
    write(chunk, enc, cb) {
      if (typeof enc === "function") [cb, enc] = [enc, undefined]
      this._pending = (this._pending || 0) + 1
      const done = err => {
        this._pending--
        cb?.(err)
        if (err) this.emit("error", err)
        if (!this._pending) this.emit("_drained")
      }
      if (this._write) this._write(chunk, enc, done)
      else queueMicrotask(() => done())
      return true
    },
    end(chunk, enc, cb) {
      if (typeof chunk === "function") [cb, chunk] = [chunk, null]
      else if (typeof enc === "function") [cb, enc] = [enc, undefined]
      if (chunk != null) this.write(chunk, enc)
      if (this._ending) return this
      this._ending = true
      const fin = () => {
        this.writableEnded = this.writableFinished = true
        this.emit("finish")
        this.emit("close")
        cb?.()
      }
      const go = () => (this._final ? this._final(err => (err ? this.emit("error", err) : fin())) : fin())
      this._pending ? this.once("_drained", go) : queueMicrotask(go)
      return this
    },
    cork() {},
    uncork() {},
    setDefaultEncoding() {
      return this
    },
  }

  class Writable extends Stream {
    constructor(opts = {}) {
      super()
      this.writable = true
      if (opts.write) this._write = opts.write
      if (opts.final) this._final = opts.final
    }
    destroy(err) {
      this.destroyed = true
      queueMicrotask(() => {
        if (err) this.emit("error", err)
        this.emit("close")
      })
      return this
    }
  }
  Object.assign(Writable.prototype, writableMethods)

  class Duplex extends Readable {
    constructor(opts = {}) {
      super(opts)
      this.writable = true
      if (opts.write) this._write = opts.write
      if (opts.final) this._final = opts.final
    }
  }
  Object.assign(Duplex.prototype, writableMethods)

  class Transform extends Duplex {
    constructor(opts = {}) {
      super(opts)
      if (opts.transform) this._transform = opts.transform
      if (opts.flush) this._flush = opts.flush
      this._write = (c, e, cb) => {
        if (!this._transform) {
          this.push(c)
          return cb()
        }
        this._transform(c, e, (err, d) => {
          if (d != null) this.push(d)
          cb(err)
        })
      }
      this._final = cb => {
        const end = () => {
          this.push(null)
          cb()
        }
        if (!this._flush) return end()
        this._flush((err, d) => {
          if (d != null) this.push(d)
          end()
        })
      }
    }
  }
  class PassThrough extends Transform {}

  const finished = (s, cb) => {
    let called = false
    const done = err => called || ((called = true), cb(err))
    s.once?.("end", () => done())
    s.once?.("finish", () => done())
    s.once?.("error", done)
    s.once?.("close", () => done())
  }
  const pipeline = (...streams) => {
    const cb = typeof streams.at(-1) === "function" ? streams.pop() : () => {}
    for (let i = 0; i < streams.length - 1; i++) {
      streams[i].on?.("error", cb)
      streams[i].pipe(streams[i + 1])
    }
    finished(streams.at(-1), cb)
    return streams.at(-1)
  }

  const stream = Object.assign(Stream, { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished })
  stream.promises = {
    pipeline: (...s) => new Promise((resolve, reject) => pipeline(...s, err => (err ? reject(err) : resolve()))),
    finished: s => new Promise((resolve, reject) => finished(s, err => (err ? reject(err) : resolve()))),
  }
  __node.stream = stream
  __node["stream/promises"] = stream.promises
  __node["stream/web"] = { ReadableStream, WritableStream, TransformStream }
})()
