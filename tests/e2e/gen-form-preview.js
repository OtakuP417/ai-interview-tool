/* 预览：新设置页表单（岗位/城市已移除）+ 对接人「其他」手填分支 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../../web/index.html'), 'utf-8');

const listMatch = src.match(/const OWNER_LIST = \[[\s\S]*?\];/);
const OWNER_LIST_SRC = listMatch[0];
const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>设置页表单预览</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #fff;
    padding: 22px; margin: 0; color: #1f2329; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
  .box { display: flex; gap: 26px; align-items: flex-start; }
  .col { flex: 1; min-width: 0; }
  .col-h { font-size: 12.5px; font-weight: 600; color: #EA5504; margin-bottom: 10px;
    padding-bottom: 6px; border-bottom: 1px solid #eee; }
  .form-group { margin-bottom: 14px; }
  label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
  .req { color: #d93025; }
  select, input, textarea { width: 100%; padding: 9px 11px; border: 1px solid #e3e5ea;
    border-radius: 8px; font-size: 13.5px; font-family: inherit; box-sizing: border-box; }
  .field-hint { font-size: 11.5px; color: #6b7280; margin-top: 5px; line-height: 1.5; }
  input[readonly] { background: #f5f6f8; color: #6b7280; cursor: default; }
  .section-sep { font-size: 12.5px; font-weight: 600; color: #EA5504; margin: 18px 0 12px; }
</style>
</head>
<body>
  <h2>访谈设置页 · 表单结构（v2026.09.28-g）</h2>
  <div class="sub">左：默认（选名单内的人，中心自动带出且只读） ｜ 右：选「其他」（姓名与中心改为手填）</div>

  <div class="box">
    <div class="col">
      <div class="col-h">A · 选择名单内的对接人</div>
      <div class="section-sep" style="margin-top:0">被访谈人信息</div>
      <div class="form-group">
        <label>姓名 <span class="req">*</span></label>
        <input type="text" value="张伟" readonly>
      </div>
      <div class="form-group">
        <label>UM 号 <span class="req">*</span></label>
        <input type="text" value="ZHANGWEI123" readonly>
      </div>
      <div class="section-sep">归档信息</div>
      <div class="form-group">
        <label>后线对接人（= 发起本次萃取的运营岗） <span class="req">*</span></label>
        <select id="selA"></select>
        <div class="field-hint">选好了下面的所属中心会自动带出。名单里没有的人选「其他」，再手动填写。</div>
      </div>
      <div class="form-group">
        <label>对接人所属中心</label>
        <input type="text" id="orgA" readonly>
      </div>
    </div>

    <div class="col">
      <div class="col-h">B · 选「其他」时手动填写</div>
      <div class="section-sep" style="margin-top:0">被访谈人信息</div>
      <div class="form-group">
        <label>姓名 <span class="req">*</span></label>
        <input type="text" value="张伟" readonly>
      </div>
      <div class="form-group">
        <label>UM 号 <span class="req">*</span></label>
        <input type="text" value="ZHANGWEI123" readonly>
      </div>
      <div class="section-sep">归档信息</div>
      <div class="form-group">
        <label>后线对接人（= 发起本次萃取的运营岗） <span class="req">*</span></label>
        <select id="selB"></select>
        <div class="field-hint">选好了下面的所属中心会自动带出。名单里没有的人选「其他」，再手动填写。</div>
      </div>
      <div class="form-group">
        <label>对接人所属中心</label>
        <input type="text" id="orgB" placeholder="选择「其他」后请手动填写（见下方）">
      </div>
      <div class="form-group">
        <label>对接人姓名 <span class="req">*</span></label>
        <input type="text" value="刘敏">
      </div>
      <div class="form-group">
        <label>对接人所属中心 <span class="req">*</span></label>
        <input type="text" value="西安第三咨询中心">
      </div>
    </div>
  </div>

  <script>
    ${OWNER_LIST_SRC}
    var OWNER_OTHER = '__other__';
    function fill(sel, pickOther) {
      sel.innerHTML = '<option value="">请选择</option>' + OWNER_LIST.map(function (item) {
        var p = item.split('|');
        return '<option value="' + p[0] + '" data-org="' + (p[1] || '') + '">'
          + p[0] + '（' + (p[1] || '未填中心') + '）</option>';
      }).join('') + '<option value="' + OWNER_OTHER + '">其他（手动填写）</option>';
      sel.value = pickOther ? OWNER_OTHER : '魏婷';
    }
    var selA = document.getElementById('selA'), orgA = document.getElementById('orgA');
    fill(selA, false);
    orgA.value = selA.options[selA.selectedIndex].dataset.org;

    var selB = document.getElementById('selB'), orgB = document.getElementById('orgB');
    fill(selB, true);
    orgB.readOnly = true;
  </script>
</body>
</html>
`;
fs.writeFileSync(path.resolve(__dirname, 'form-preview.html'), html);
console.log('OK 表单预览页已生成');
