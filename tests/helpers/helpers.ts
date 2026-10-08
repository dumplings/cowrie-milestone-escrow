import * as anchor from "@anchor-lang/core";

export function cwrToBaseUnits(cwr: number | string, decimals: number) {
  return new anchor.BN(cwr).mul(
      new anchor.BN(10).pow(new anchor.BN(decimals))
  );
}

export function u64ToLeBuffer(value: anchor.BN) {
  return value.toArrayLike(Buffer, "le", 8);
}
