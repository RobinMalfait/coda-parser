export class StringStream {
  constructor(
    private str: string,
    private pos = 0
  ) {}

  skip(n: number) {
    this.pos += n
    return this
  }

  take(n: number) {
    let taken = this.str.slice(this.pos, this.pos + n)
    this.pos += n
    return taken
  }
}
