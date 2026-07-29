const fs = require('fs');
const { execSync } = require('child_process');

const standardSvg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#0F172A"/>
  <circle cx="256" cy="256" r="190" fill="url(#emerald_grad)"/>
  <circle cx="256" cy="256" r="186" stroke="#34D399" stroke-width="4" stroke-opacity="0.3" fill="none"/>
  <path d="M156 200C156 155.817 191.817 120 236 120H276C320.183 120 356 155.817 356 200V240C356 284.183 320.183 320 276 320H220L156 376V200Z" fill="#FFFFFF"/>
  <path d="M256 170C256 170 296 178 310 188V236C310 276 276 302 256 310C236 302 202 276 202 236V188C222 189 256 182 256 182Z" fill="#10B981"/>
  <rect x="236" y="235" width="40" height="34" rx="6" fill="#FFFFFF"/>
  <path d="M244 235V222C244 215.373 249.373 210 256 210C262.627 210 268 215.373 268 222V235" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" fill="none"/>
  <circle cx="256" cy="250" r="4" fill="#10B981"/>
  <path d="M256 254V260" stroke="#10B981" stroke-width="3" stroke-linecap="round"/>
  <defs>
    <linearGradient id="emerald_grad" x1="256" y1="66" x2="256" y2="446" gradientUnits="userSpaceOnUse">
      <stop stop-color="#059669"/>
      <stop offset="1" stop-color="#047857"/>
    </linearGradient>
  </defs>
</svg>`;

const maskableSvg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#0F172A"/>
  <circle cx="256" cy="256" r="160" fill="url(#emerald_grad_maskable)"/>
  <circle cx="256" cy="256" r="156" stroke="#34D399" stroke-width="4" stroke-opacity="0.3" fill="none"/>
  <path d="M172 208C172 170.445 202.445 140 240 140H272C309.555 140 340 170.445 340 208V242C340 279.555 309.555 310 272 310H226L172 358V208Z" fill="#FFFFFF"/>
  <path d="M256 182C256 182 290 189 302 198V238C302 272 273 294 256 301C239 294 210 272 210 238V198C222 189 256 182 256 182Z" fill="#10B981"/>
  <rect x="239" y="238" width="34" height="28" rx="5" fill="#FFFFFF"/>
  <path d="M246 238V227C246 221.477 250.477 217 256 217C261.523 217 266 221.477 266 227V238" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" fill="none"/>
  <circle cx="256" cy="250" r="3" fill="#10B981"/>
  <defs>
    <linearGradient id="emerald_grad_maskable" x1="256" y1="96" x2="256" y2="416" gradientUnits="userSpaceOnUse">
      <stop stop-color="#059669"/>
      <stop offset="1" stop-color="#047857"/>
    </linearGradient>
  </defs>
</svg>`;

fs.writeFileSync('temp_std.svg', standardSvg);
fs.writeFileSync('temp_mask.svg', maskableSvg);

execSync('ffmpeg -y -i temp_std.svg -s 512x512 public/icon-512.png');
execSync('ffmpeg -y -i temp_std.svg -s 192x192 public/icon-192.png');
execSync('ffmpeg -y -i temp_mask.svg -s 512x512 public/icon-maskable-512.png');
execSync('ffmpeg -y -i temp_mask.svg -s 192x192 public/icon-maskable-192.png');
execSync('ffmpeg -y -i public/icon-192.png -s 32x32 public/favicon.ico');

fs.unlinkSync('temp_std.svg');
fs.unlinkSync('temp_mask.svg');

console.log('Successfully generated clean binary PNG icons!');
