/* 生成带溢出探针的临时页面：加载后把超宽元素写进 <title>，
   再用 headless --dump-dom 读出来。 */
const fs = require('fs');
const path = require('path');
let s = fs.readFileSync(path.join(__dirname, '../../web/index.html'), 'utf8');

const probe = `
<script>
window.addEventListener('load', function(){
  setTimeout(function(){
    var vw = document.documentElement.clientWidth;
    var sw = document.documentElement.scrollWidth;
    var bad = [];
    document.querySelectorAll('body *').forEach(function(el){
      var r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        bad.push(el.tagName + '.' + String(el.className).slice(0, 26) + ' R=' + Math.round(r.right) + ' W=' + Math.round(r.width));
      }
    });
    var lines = ['VW=' + vw + '  SW=' + sw + '  超宽元素数=' + bad.length].concat(bad.slice(0, 12));
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff;border:2px solid #000;padding:8px;font:12px/1.5 monospace;max-width:100%;overflow:hidden;';
    d.textContent = lines.join('\\n');
    document.body.appendChild(d);
    document.title = lines.join(' | ');
  }, 400);
});
</` + `script>`;

s = s.replace('</body>', probe + '\n</body>');
fs.writeFileSync(path.join(__dirname, 'out', 'probe-overflow.html'), s);
console.log('已写 tests/e2e/out/probe-overflow.html');
