
/*
  memory.js
  - 2D memory with bounds checking and verbose logging.
  - Default: 8 row bits, 8 column bits -> 256x256 grid (SIZE = 65536).
*/

export default class Memory2D {
  static CONFIG = { ROW_BITS: 8, COL_BITS: 8 };

  constructor(hostAPI = {}) {
    this.hostAPI = hostAPI;
    const rb = Memory2D.CONFIG.ROW_BITS;
    const cb = Memory2D.CONFIG.COL_BITS;
    if (rb + cb > 16) {
      throw new Error('Memory2D: ROW_BITS + COL_BITS must be <= 16');
    }
    this.ROW_BITS = rb;
    this.COL_BITS = cb;
    this.ROWS = 1 << this.ROW_BITS;
    this.COLS = 1 << this.COL_BITS;
    this.SIZE = this.ROWS * this.COLS;
    this.grid = Array.from({ length: this.ROWS }, () => new Uint32Array(this.COLS));
    if (!this.hostAPI.debugLog) {
      this.hostAPI.debugLog = (msg) => this.hostAPI.debug && console.log(`[MEM] ${msg}`);
    }
  }

  addrToCoord(addr) {
    addr = addr >>> 0;
    const colMask = (1 << this.COL_BITS) - 1;
    const col = addr & colMask;
    const row = (addr >>> this.COL_BITS) & ((1 << this.ROW_BITS) - 1);
    return { row, col };
  }

  inBounds(addr) {
    return addr >>> 0 < this.SIZE >>> 0;
  }

  read(addr) {
    if (!this.inBounds(addr)) {
      const msg = `MEM READ OOB addr=0x${(addr >>> 0).toString(16)}`;
      this.hostAPI.debugLog(msg);
      throw Object.assign(new Error(msg), { code: 601, addr });
    }
    const { row, col } = this.addrToCoord(addr);
    const val = this.grid[row][col] >>> 0;
    this.hostAPI.debugLog(`MEM READ  addr=0x${addr.toString(16).padStart(4, '0')} -> [r${row},c${col}] = ${val}`);
    return val;
  }

  write(addr, value) {
    if (!this.inBounds(addr)) {
      const msg = `MEM WRITE OOB addr=0x${(addr >>> 0).toString(16)} val=${value >>> 0}`;
      this.hostAPI.debugLog(msg);
      throw Object.assign(new Error(msg), { code: 602, addr, value });
    }
    const { row, col } = this.addrToCoord(addr);
    this.grid[row][col] = value >>> 0;
    this.hostAPI.debugLog(`MEM WRITE addr=0x${addr.toString(16).padStart(4, '0')} -> [r${row},c${col}] = ${this.grid[row][col]}`);
  }

  dumpWindow(addr, radiusRows = 1, radiusCols = 4) {
    const { row, col } = this.addrToCoord(addr);
    const rows = [];
    for (let r = Math.max(0, row - radiusRows); r <= Math.min(this.ROWS - 1, row + radiusRows); r++) {
      const cols = [];
      for (let c = Math.max(0, col - radiusCols); c <= Math.min(this.COLS - 1, col + radiusCols); c++) {
        cols.push(this.grid[r][c] >>> 0);
      }
      rows.push({ row: r, cols });
    }
    return rows;
  }
}
