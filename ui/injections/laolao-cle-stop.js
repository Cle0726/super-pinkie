/* cle-stop:v1 —— 被中断：墨线卸力，塌到底线上、褪成灰
 *
 * 要和「完成」（落款）一眼分得开：不写字、不发光、不出墨晕。粒子先回到 C.le. 原样，
 * 然后像松了劲一样沿笔顺一段接一段塌到基线上，两个点掉下去轻轻弹一下，颜色褪成灰。
 * cle-stage 让它停一会儿，再交回矢量签名。
 * 灰借用「红」那一路通道的负半边（-1 = 全灰），失败的红和中断的灰之间也是连着变的。
 */
import {PART, STRIDE, X, Y, Z, W, GLOW, ALPHA, RED, clamp, smooth, viewX, viewY} from './laolao-cle-kit.js';

export const FLOOR = 80;   // 画布坐标里的基线（签名最低处约 84）
const KEEP = .3;           // 塌下去以后还剩原来高度的多少
const RIPPLE = .45;        // 从 C 到最后一个点，一段接一段塌，前后错开多少秒
const SAG = .85;           // 每一段塌下去用多久
const DROP = .55;          // 点掉到基线用多久（含弹一下）

export function stopForm({P, out}) {
  const {DOT1, DOT2} = PART;
  return {
    place(i, t) {
      const o = i * STRIDE, p = P.part[i], dot = p === DOT1 || p === DOT2, late = t - P.order[i] * RIPPLE;
      const x0 = dot ? viewX(P.text[i * 3]) : P.cx[i], y0 = dot ? viewY(P.text[i * 3 + 1]) : P.cy[i];
      const k = clamp(late / SAG), e = k * k * (3 - 2 * k);
      let y = y0 + (FLOOR - y0) * (1 - KEEP) * e;
      if (dot) {
        const f = clamp(late / DROP), fall = f < .7 ? (f / .7) ** 2 : 1 - Math.sin((f - .7) / .3 * Math.PI) * .18;
        y = y0 + (FLOOR + 1 - y0) * fall;
      }
      out[o + X] = x0 + (x0 - 96) * .05 * e;                // 塌的时候往两边摊开一点
      out[o + Y] = y;
      out[o + Z] = P.text[i * 3 + 2] * (1 - e);
      out[o + W] = P.width[i] * (1 - .4 * e);
      out[o + GLOW] = 0;
      out[o + ALPHA] = 1 - .3 * e;
      out[o + RED] = -smooth(0, .6, t);
    },
  };
}
