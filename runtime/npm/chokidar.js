/** chokidar：不监听文件（浏览器里拿不到文件事件），返回空的 watcher */
import { EventEmitter } from "node:events"

export class FSWatcher extends EventEmitter {
  add() {
    return this
  }
  unwatch() {
    return this
  }
  close() {
    return Promise.resolve()
  }
  getWatched() {
    return {}
  }
}
export const watch = () => new FSWatcher()
export default { watch, FSWatcher }
