import Bank3D from "./bank3d/Bank3D";

/**
 * The Bank tab. Renders a native 3D bank interior with service counters,
 * ATM machines, and fake people. Future: connect ATMs / counters to crypto
 * wallet creation, deposit, and withdrawal flows.
 */
function Bank(): React.JSX.Element {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Bank3D />
    </div>
  );
}

export default Bank;
