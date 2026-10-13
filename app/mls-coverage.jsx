/* The MLS Coverage room (v95): MRE Office's county map, exactly as it was.
 *
 * The map is fixed content from our own code (lib/mls-coverage-map.js, copied
 * byte for byte from MRE Office), never anything a person typed, and it holds
 * no script, handler or link; tests check that. It is drawn on the server, so
 * the 150 KB of county shapes are not shipped again inside the page's
 * JavaScript. The hover tips are the small client piece beside it.
 */
import { MLS_COVERAGE_CSS, MLS_COVERAGE_HTML } from "../lib/mls-coverage-map.js";
import MlsCoverageTips from "./mls-coverage-tips.jsx";

export default function MlsCoverage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MLS_COVERAGE_CSS }} />
      <div className="jx-mlscov" dangerouslySetInnerHTML={{ __html: MLS_COVERAGE_HTML }} />
      <MlsCoverageTips />
    </>
  );
}
