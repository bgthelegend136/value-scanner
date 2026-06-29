// Tiny formatting helpers shared between the CLI entrypoint and extracted command
// modules. Kept in their own module so command modules can import them without a
// circular dependency on cli.mjs.
export function signed(value, digits = 4) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}
