const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const fields = {
  width: {value:'808+880', hasAttribute: () => true},
  height: {value:'1800 + 200', hasAttribute: () => true},
  doorCount: {value:'2', hasAttribute: () => false},
};
const context = vm.createContext({document:{getElementById:id=>fields[id]}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/utils.js'),'utf8'),context);
for (const [input, expected] of [
  ['808+880',1688],['808 + 880 + 312',2000],['3000+3000',6000],
  ['6000+1',6001],['1200',1200],[' 800 + 400 ',1200],
  ['808,5+879.5',1688],['0.1+0.2',0.3],['0+600',600],
]) assert.equal(context.parseDimensionSum(input),expected,input);
for (const input of ['', ' ', '808+', '+808', '808++880','808+-10',
  '808+abc','808+880mm','8 08+880','1e3','Infinity','1/0','2*400',
  'alert(1)','808;880','900-20']) {
  assert.ok(Number.isNaN(context.parseDimensionSum(input)),input);
}
assert.equal(vm.runInContext("num('width')",context),1688);
assert.equal(vm.runInContext("num('height')",context),2000);
assert.equal(vm.runInContext("num('doorCount',2)",context),2);
fields.width.value='808+';
assert.equal(vm.runInContext("num('width',1200)",context),1200);
console.log('PASS: sums, whitespace, decimals, incomplete/unsafe input and numeric readers');
