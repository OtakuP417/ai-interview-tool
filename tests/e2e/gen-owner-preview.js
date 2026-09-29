/* 预览：后线对接人下拉 + 选人自动带出所属中心（用真实 OWNER_LIST 与 syncOwnerOrg 逻辑） */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../web/index.html'), 'utf-8');

const listMatch = src.match(/const OWNER_LIST = \[[\s\S]*?\];/);
if (!listMatch) throw new Error('OWNER_LIST not found');
const OWNER_LIST_SRC = listMatch[0];

/* 预览页模拟 fillOwnerOptions 的三个关键行为：按名单填、选人带出、记住上次 */
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>后线对接人下拉预览</title>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background: #fff; padding: 24px; margin: 0; color: #1f2329; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 18px; }
  .form-group { margin-bottom: 16px; }
  label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
  .req { color: #d93025; }
  select, input { width: 100%; max-width: 340px; padding: 9px 11px; border: 1px solid #e3e5ea;
    border-radius: 8px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
  .field-hint { font-size: 12px; color: #6b7280; margin-top: 5px; }
  input[readonly] { background: #f5f6f8; color: #6b7280; cursor: default; }
  #mirror { margin-top: 22px; border-top: 1px solid #e3e5ea; padding-top: 14px; }
  table { border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #e3e5ea; padding: 5px 10px; text-align: left; }
  th { background: #f5f6f8; font-weight: 600; }
  code { background: #f5f6f8; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
</style>
</head>
<body>
  <h2>后线对接人（下拉）· 中心命名已统一</h2>
  <div class="sub">点开下拉可见全部 8 人；选中后「对接人所属中心」自动带出且不可编辑</div>

  <div class="form-group">
    <label>后线对接人（= 发起本次萃取的运营岗） <span class="req">*</span></label>
    <select id="f-owner"><option value="">请选择</option></select>
    <div class="field-hint">选好了下面的所属中心会自动带出。找不到人时请联系管理员添加。</div>
  </div>
  <div class="form-group">
    <label>对接人所属中心</label>
    <input type="text" id="f-owner-org" placeholder="选择对接人后自动带出" readonly>
  </div>

  <div id="mirror">
    <div class="sub" style="margin-bottom:8px">名单明细（= 代码里的 OWNER_LIST，用于核对）</div>
    <table id="tbl"><tr><th>姓名</th><th>所属中心</th></tr></table>
  </div>

  <script>
    ${OWNER_LIST_SRC}
    var sel = document.getElementById('f-owner');
    var org = document.getElementById('f-owner-org');
    var tbl = document.getElementById('tbl');
    OWNER_LIST.forEach(function (it) {
      var p = it.split('|'), name = p[0], o = p[1];
      var op = document.createElement('option');
      op.value = name; op.textContent = name; op.dataset.org = o;
      sel.appendChild(op);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + name + '</td><td>' + o + '</td>';
      tbl.appendChild(tr);
    });
    function sync() {
      var opt = sel.options[sel.selectedIndex];
      org.value = (opt && opt.dataset && opt.dataset.org) ? opt.dataset.org : '';
    }
    sel.addEventListener('change', sync);
    /* 预览几种状态：默认选中一个西安中心和一个外地中心 */
    sel.value = '魏婷'; sync();
    window.__pick = function (n) { sel.value = n; sync(); };
  </script>
</body>
</html>
`;
const p = path.resolve(__dirname, 'owner-dropdown-preview.html');
fs.writeFileSync(p, html);
const names = (src.match(/const OWNER_LIST = \[[\s\S]*?\];/)[0].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
console.log('OK 预览页已生成，名单 ' + names.length + ' 人：' + names.join('、'));
