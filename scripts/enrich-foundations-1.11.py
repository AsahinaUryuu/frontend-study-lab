"""Apply hand-authored teaching additions; reruns do not duplicate sections/questions.

Run from the application root: python -X utf8 scripts/enrich-foundations-1.11.py
No existing question, answer, lesson identifier or reference solution is rewritten.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.11.0'
ADDITIONS = {}


def code(source, explanation, language='javascript'):
    return {'source': source.strip(), 'language': language, 'explanation': explanation}


def section(title, paragraphs, points, example=None):
    result = {'title': title, 'paragraphs': paragraphs, 'points': points}
    if example:
        result['code'] = example
    return result


def choice(prompt, options, answer, explanation, example=None):
    result = {'type': 'choice', 'prompt': prompt, 'options': options, 'answer': answer, 'explanation': explanation}
    if example:
        result['code'] = {'language': 'javascript', 'source': example.strip()}
    return result


def fill(prompt, answers, explanation, sensitive=True):
    reason = '本题填写代码中的实际API名称，大小写属于名称的一部分，必须按规范拼写。' if sensitive else '本题填写HTML普通属性名，ASCII字母不区分大小写；参考答案采用推荐的小写形式。'
    return {'type': 'fill', 'prompt': prompt, 'answer': answers, 'explanation': explanation, 'caseSensitive': sensitive, 'caseReason': reason}


def add(id, sections, questions, hints, rubric, sources):
    ADDITIONS[id] = {'sections': sections, 'questions': questions, 'hints': hints, 'rubric': rubric, 'sources': sources}


add('js-closure', [
    section('读到的是变量，还是当时算出的文字？', [
        '闭包能继续访问外层变量，但不会把所有表达式自动重新计算。下面的 read 每次调用都读取同一个 count 绑定；label 则在创建计数器时就已经算成字符串。把“变量仍然可访问”和“某次计算的结果会更新”分开，才能理解计数器、缓存和延迟回调。',
        '先调用 makeMeter 得到两个方法，再调用 add 修改 count，最后比较 read 和 label。工厂已经返回，方法仍能访问那一次调用创建的环境；再次调用工厂会创建另一份环境。闭包不是只能读取旧值，它可以读取更新后的值，也可以有意保存一个旧快照。'
    ], ['观察：先预测三项输出，再运行；第二个工厂实例为什么不受 add 影响？', '误区：label 没变并不代表闭包失效，而是没有重新执行字符串拼接。', '迁移练习：增加 getLabel()，使它每次返回当前次数；保留原 label 作为创建时记录。'], code('''function makeMeter() {
  let count = 0;
  const label = `创建时次数：${count}`;
  return { add: () => ++count, read: () => count, label };
}
const first = makeMeter();
const second = makeMeter();
first.add();
console.log(first.read());
console.log(first.label);
console.log(second.read());''', '依次输出 1、创建时次数：0、0。read 访问绑定，label 保存早先计算出的字符串。')),
    section('把状态的所有者和释放时机一起设计', [
        '一个工厂返回的 next 和 reset 应共享内部状态，而两个计数器实例应该彼此独立。这种所有权比“有一个内层函数”更重要：状态放到全局会串号，放到 next 内部又会每次归零。画出实例、方法、变量三者之间的引用，通常比背“闭包保存变量”更容易定位错误。',
        '事件监听器、定时器或长期保存的回调可能让相关数据继续可达。闭包本身不是内存泄漏的判据；当页面已不再需要某个订阅，却仍由监听器持有它时，才需要解除订阅并清理引用。对于计数器本题无需手工释放内存，但对于真实组件，应在设计订阅时同时设计返回的解绑函数。'
    ], ['观察：创建 a(10)、b(-2)，依次执行 a.next、b.next、a.reset、a.next，并写出状态表。', '误区：reset 回到最初 start，不是统一设成 0；reset 也需要返回约定值。', '迁移练习：把相同思路用于“每个上传任务自己的重试次数”，说明状态应该放在哪里。'])
], [
    choice('下面为什么输出 0 和 1？', ['闭包只能记住最旧的值', 'saved 保存计算结果，read 每次读取同一变量绑定', 'add 创建了第二个全局变量', 'const 使全部外层变量不能变化'], 1, 'saved 是工厂执行时得到的数值副本；read 是函数，调用时才读取 n。n 的绑定被 add 修改后，read 能看到新值。', '''function make() {
  let n = 0;
  return { saved: n, add: () => ++n, read: () => n };
}
const meter = make();
meter.add();
console.log(meter.saved, meter.read());'''),
    choice('给每个上传任务创建独立重试计数器，应把可变计数放在哪里？', ['所有任务共用的全局变量', '每次 next 调用的函数体里', '每次工厂调用的局部环境里，由返回方法共同访问', 'HTML 的 title 属性里'], 2, '每次工厂调用建立独立环境，同一实例的方法共享该环境。全局状态会串号，放在 next 内会被反复初始化。')
], ['先列出 start=-2 的 next/reset/next 结果：-1、-2、-1，再检查实现。', '解构取出 next 再调用也应可用；本题的状态归闭包所有，不依赖 this。'], ['边界自检：默认 start、负数 start、连续两次 reset 与两个实例交错调用均满足原约定。'], [
    ('MDN：闭包与共享词法环境', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures', '核对闭包访问词法环境、同次工厂调用的方法共享绑定，不同调用环境独立；快照对照例为原创。')
])

add('js-this', [
    section('把方法交出去之前，检查接收者还在不在', [
        '对象属性里保存的是函数值，不是永远带着对象的专属动作。order.total() 在调用点提供 order 作为 this；把函数取到变量后再直接调用，就失去了这个接收者。在严格模式普通调用中 this 是 undefined，读取 this.price 会报错，而不是神奇地回到原对象。',
        'bind 创建一个绑定函数，今后普通调用时使用指定接收者；call 和 apply 则立即执行。下面先绑定，再修改 order.price，绑定函数会读到新价格，因为绑定的是对象引用，并不是把价格拍成快照。事件回调、数组回调和计时器最容易暴露这种“方法被取出”的问题。'
    ], ['观察：运行后两次结果应为 30、36；把 bound 换成 loose 直接调用，比较严格模式的错误。', '误区：给 bound 再 call 另一个对象，不会替换已有绑定的 this。', '迁移练习：写一个按钮点击包装函数，把事件对象转换为业务参数后再调用 order.total。'], code('''"use strict";
const order = { price: 10, total(quantity) { return this.price * quantity; } };
const loose = order.total;
const bound = loose.bind(order);
console.log(bound(3));
order.price = 12;
console.log(bound.call({ price: 999 }, 3));''', 'bind 固定普通调用的接收者，不冻结对象属性。第二次 call 不能覆盖已经绑定的 this。')),
    section('箭头回调借用外层，而不是从属性名推断 this', [
        '箭头函数没有自己的 this 绑定，调用时会沿定义位置使用外层 this。把箭头直接写成对象属性，不等于让它借用这个对象；对象字面量不会为箭头建立一层 this。更常见的用法是在普通方法内部创建箭头回调，借用这个方法本次执行时得到的接收者。',
        '本题 bindMethod 需要保存 obj[key] 这个原函数，再用 obj 调用并透传参数、返回值。包装函数不应依赖调用它的人，也不应在没有要求时吞掉原函数错误。先明确是绑定“此刻取到的方法”，还是每次读取同名属性；本题的参考实现采用前者。'
    ], ['观察：把包装后的函数赋到另一个对象属性上调用，结果仍应来自原 obj。', '误区：只写 fn(...args) 透传了参数，却丢失了 this；只调用不 return 则丢失结果。', '迁移练习：假设原方法返回 Promise，解释为什么直接 return 就能保留异步结果，而不必重复包装 Promise。'], code('''const owner = {
  name: '小林',
  makeReader() { return () => this.name; }
};
const reader = owner.makeReader();
console.log(reader.call({ name: '其他人' }));''', '输出小林。箭头是在 makeReader 调用期间创建的，借用那次普通方法调用的 this。'))
], [
    choice('这段严格模式代码会发生什么？', ['输出 8', '输出 undefined，但不会报错', '读取 undefined 的 price 时抛出 TypeError', '自动使用 window.price'], 2, '方法被取出后，fn() 是普通调用。严格模式下 this 为 undefined；错误发生在读取 this.price，而不是取出方法时。', '''"use strict";
const item = { price: 8, getPrice() { return this.price; } };
const fn = item.getPrice;
fn();'''),
    choice('已用 fn.bind(a) 得到 bound，再执行 bound.call(b)，普通调用的 this 是谁？', ['b', 'a', '同时是 a 和 b', '一定为 undefined'], 1, '绑定函数保留先前的 thisArg；call 提供的 thisArg 不能覆盖它。这里讨论普通调用，不涉及 new 调用绑定函数。')
], ['用两个参数和返回对象的方法测试，避免只对零参数示例碰巧正确。', '把返回函数放进另一个对象调用，检查是否仍使用原 obj。'], ['原方法的返回值与抛出的错误原样向调用者传递，不转换为 undefined。'], [
    ('MDN：bind 的接收者与返回函数', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind', '核对绑定函数普通调用的 this 与后续 call/bind 不覆盖已绑定接收者；不推广到 new。'),
    ('MDN：this 与箭头函数', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this', '核对严格模式普通调用及箭头函数词法 this，例子明确执行上下文。')
])

add('js-event-loop', [
    section('把微任务画成队列，而不是背固定口令', [
        '“同步、微任务、定时器”只是推导入口，真正需要跟踪的是每一步什么时候入队。同步代码创建的微任务先等待当前调用栈完成；处理某个微任务时新加入的微任务排到队尾，并在这次检查点继续处理，直到队列为空。',
        '下面初始微任务队列是 A、B。A 执行时把 C 加到尾部，所以不是 A、C、B。timer 是后续任务，零毫秒只是最早调度意图，并不表示立即执行，也不保证页面每次在它前面绘制。这个推导限定浏览器常规脚本，不借用 Node.js 特有队列。'
    ], ['步骤：先记下 sync；画队列 [A,B]；执行 A 后变 [B,C]；清空后才处理 timer。', '误区：微任务内创建的微任务不会递归插队到已排队任务前面。', '迁移练习：把 C 的 queueMicrotask 改为 setTimeout，重新标出它属于哪种队列。'], code('''console.log('sync');
queueMicrotask(() => {
  console.log('A');
  queueMicrotask(() => console.log('C'));
});
Promise.resolve().then(() => console.log('B'));
setTimeout(() => console.log('timer'), 0);''', '在所述浏览器脚本场景中输出 sync、A、B、C、timer；队列中的先后顺序比函数名更重要。')),
    section('await 已完成的 Promise，不等于给绘制让路', [
        'await Promise.resolve() 会让后续代码进入微任务流程，但浏览器仍需要完成微任务检查点。若一个长循环不断 await 已完成的 Promise，微任务可能持续排队，按钮点击和绘制仍得不到机会。“异步”不等于“在另一个线程”，也不等于“每一步后都会显示进度条”。',
        '把大任务切成适量小块，并在块之间让出一个任务机会，是观察页面响应性的入门实验。下面用定时器形成教学用让出点；它不保证精确帧率。真正大量 CPU 计算还应评估 Worker；本课 runSequential 的目标则是控制任务的启动顺序，不能先 map 调用所有工厂再逐个 await。'
    ], ['观察：分别使用 Promise.resolve 和定时器让出点，处理大量数据时尝试点击页面按钮。', '误区：Promise 包住的同步重计算仍在当前线程执行；代码不是写进 then 就变为并行。', '迁移练习：给 runSequential 记录 start/end 日志，验证前一项 end 之后才有下一项 start。'], code('''const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
async function processInChunks(items, handle) {
  for (let i = 0; i < items.length; i++) {
    handle(items[i]);
    if ((i + 1) % 100 === 0) await yieldTask();
  }
}''', 'handle 在这里假设是同步操作。每100项让出一次后续任务机会，块大小需按实际计算量测量。'))
], [
    choice('浏览器常规脚本中，以下代码输出顺序是什么？', ['A C B', 'A B C', 'B A C', 'C A B'], 1, '初始队列中 A 在 B 前；A 执行时把 C 加在已有 B 后面。同一检查点会继续处理 B、C。', '''queueMicrotask(() => {
  console.log('A');
  queueMicrotask(() => console.log('C'));
});
queueMicrotask(() => console.log('B'));'''),
    choice('处理大量同步计算的循环里反复 await Promise.resolve()，能否保证每轮都有页面绘制？', ['能，每个 await 都产生一个动画帧', '不能，连续微任务仍可能阻塞后续任务与绘制机会', '能，它会自动创建 Worker', '不能，因为 await 完全不让出执行'], 1, 'await 会暂停当前异步函数，但已经兑现的 Promise 把继续执行安排为微任务；持续微任务不等于给浏览器留出任务和绘制机会。')
], ['用 []、普通值任务、异步任务、第二项抛错四组输入检查。', '失败用一个额外数组记录已启动任务，确认失败后第三项工厂从未被调用。'], ['同步抛错和异步拒绝都应停止后续工厂；验证启动次数，不能仅看最终返回值。'], [
    ('MDN：微任务检查点', 'https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide', '核对微任务会继续清空新入队的微任务、递归微任务可能延迟其他任务；不保证具体绘制时刻。')
])

add('js-promise', [
    section('链条是否连上，取决于有没有 return', [
        'then 返回一个新 Promise。回调返回普通值时，新 Promise 使用这个值兑现；返回另一个 Promise 时，新 Promise 跟随它的最终结果；抛错则使后续链拒绝。如果只是启动异步任务却没有 return，外层链不知道需要等待它，也无法通过同一条链接收它的错误。',
        '下面把一次业务处理拆成读取、转换、展示三个步骤，每一段都返回下一段需要的值。再故意删除中间的 return，观察后一段为什么得到 undefined。调试时应沿每个箭头检查输入、输出和错误出口，而不是用更多 then 或 setTimeout 猜测时机。'
    ], ['步骤：读取结果为 {name:"mori"}；转换阶段返回 MORI；最后阶段打印字符串。', '误区：花括号箭头回调不会隐式返回表达式；写成 user => { user.name } 会丢值。', '迁移练习：把转换改成会拒绝的异步函数，验证错误能沿 return 串起的链到达调用方。'], code('''const fetchUser = () => Promise.resolve({ name: 'mori' });
Promise.resolve()
  .then(fetchUser)
  .then(user => {
    return user.name.toUpperCase();
  })
  .then(name => console.log(name));''', '输出 MORI。每个阶段的返回值成为后一个成功处理器的输入。')),
    section('错误恢复、错误上抛和最终清理是三种选择', [
        'catch 不是一个只负责打印的旁观者。它正常返回备用值，后面的链就恢复为成功；它重新 throw，调用方才能继续看到失败。要记录错误而不把失败伪装成成功，应记录后抛出。业务上确实允许备用值时，返回备用值才是明确的恢复策略。',
        'finally 适合关闭 loading 等清理。清理回调正常结束时，原来的结果通常继续传递；如果清理本身抛错或返回拒绝的 Promise，则会覆盖原结果。不要在 finally 中随意抛出新错误，也不要以为 return 一个普通值会替换前一步成功值。'
    ], ['观察：catch 返回备用字符串后，then 会执行；把 return 改成 throw 后，then 跳过。', '误区：catch(error => console.log(error)) 正常返回 undefined，通常会把失败恢复成 undefined。', '迁移练习：给 loadUserName 加调用方 catch 与 finally，分别承担错误提示和关闭加载状态。'], code('''Promise.resolve('原结果')
  .finally(() => '清理返回值')
  .then(value => console.log(value));
Promise.reject(new Error('网络中断'))
  .catch(error => { throw error; })
  .catch(error => console.log(error.message));''', '两条独立链分别输出原结果与网络中断。finally 的普通返回值不会替换原结果。'))
], [
    choice('下面最后一个 then 得到什么？', ['MORI', 'undefined', '整个 user 对象', '必然拒绝'], 1, '带花括号的箭头回调没有 return，正常结束的返回值是 undefined。toUpperCase 虽被调用，但结果没有交给链。', '''Promise.resolve({ name: 'mori' })
  .then(user => { user.name.toUpperCase(); })
  .then(value => console.log(value));'''),
    choice('想记录异常但继续让 loadUserName 的调用方识别失败，catch 应怎么处理？', ['只 console.log 后结束', 'return null', '记录后 throw 原错误', 'return "失败"'], 2, 'throw 让后续链保持拒绝。其余正常返回都代表恢复为成功值，调用方的 catch 就不再因这个错误触发。')
], ['分别让 fetchUser 同步抛错、返回拒绝 Promise、成功返回姓名，核对三个路径。', '成功用小写姓名验证转换；异常用同一个 Error 实例验证没有被吞掉。'], ['失败不得转换成空字符串或 undefined；调用方必须能通过 catch 捕获同步抛错及异步拒绝。'], [
    ('MDN：Promise.then 返回值规则', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then', '核对回调普通值、Promise、抛错及缺少返回值的传播语义。'),
    ('MDN：Promise.finally', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/finally', '核对 finally 普通返回值不替换原结果、抛错或返回拒绝 Promise 可改变结果。')
])

add('js-async', [
    section('启动时间、完成时间和结果位置分别记录', [
        '并发的关键是让独立任务都先启动，再一起等待。把两个函数调用放进 Promise.all 的数组时，数组表达式从左到右求值，两个任务会在等待聚合结果前开始。结果数组仍按输入位置排列，不是谁先完成谁排第一。若第二项需要第一项的结果，则不能机械地改成并发。',
        '可以用手动控制完成时机的 Promise 来验证，并不需要访问真实网络或依靠精确的计时器。下面先启动 A、B，再让 B 完成、A 完成；最终结果仍是 A结果、B结果。若普通函数在启动时同步抛错，数组求值会中断，所以“两个都必然启动”需要题目明确它们是正常返回 Promise 的异步函数。'
    ], ['步骤：先看到启动A、启动B；完成顺序故意颠倒；检查结果位置仍对应输入。', '误区：Promise.all 不会替你调用放在数组里的函数，传函数本身会把它当普通值。', '迁移练习：分别写“先取用户ID再取订单”和“同时取天气与公告”，说明为何启动策略不同。'], code('''let finishA, finishB;
const getA = () => { console.log('启动A'); return new Promise(r => { finishA = r; }); };
const getB = () => { console.log('启动B'); return new Promise(r => { finishB = r; }); };
const pending = Promise.all([getA(), getB()]);
finishB('B结果');
finishA('A结果');
pending.then(([a, b]) => console.log(a, b));''', '最后一行输出 A结果 B结果，完成时间不改变 Promise.all 的结果对应关系。')),
    section('forEach 不负责等待异步回调的作业', [
        'forEach 调用回调后，不会收集和等待回调返回的 Promise。因此 await items.forEach(async ...) 等待的通常只是 forEach 返回的 undefined，外层函数可能在保存完成前就继续执行。串行保存选 for...of 配合 await；独立保存并发执行则用 map 创建 Promise 数组，再 await Promise.all。',
        '并发请求失败后，其他已经开始的任务不会自动撤销。若业务要求收集全部失败与成功，可使用 allSettled；若需要取消网络请求，则给相应请求传取消信号。选择策略要从业务要求出发：是否允许部分成功、是否有先后依赖、错误应由谁处理。'
    ], ['观察：在每个 save 前后和整个循环之后加日志，比较串行与并发版本。', '误区：把 forEach 外面补一个 await，并不能改变 forEach 不收集 Promise 的行为。', '迁移练习：三张头像允许部分上传成功，选择 allSettled 并为每项设计对应的成功/失败提示。'])
], [
    choice('两项独立任务按 B、A 的顺序完成，Promise.all([getA(),getB()]) 的结果顺序是？', ['按完成顺序 B、A', '按输入位置 A、B', '顺序随机', '只返回 A'], 1, '聚合结果按输入位置保存；并发缩短等待并不改变每个结果与请求的对应关系。'),
    choice('希望并发保存所有 items，并在全部成功后继续，应选哪种写法？', ['await items.forEach(async x => save(x))', 'await Promise.all(items.map(x => save(x)))', 'Promise.all([save])', 'items.forEach(x => save(x)); return "完成"'], 1, 'map 返回每项保存的 Promise，all 才有可等待的任务集合。forEach 返回 undefined；放入函数引用不会启动保存。')
], ['用可手动 resolve 的两个 Promise 检查：两次调用都发生后，再完成 B、A，结果仍为 {a,b}。', '构造一个拒绝的异步任务，检查调用方能捕获；不要声称另一个任务已自动取消。'], ['结果映射按参数身份而非完成先后；失败路径不返回伪造的成功对象。'], [
    ('MDN：Promise.all 的顺序与拒绝', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all', '核对输入顺序保留、聚合拒绝不自动取消其他操作，原创手动完成实验。'),
    ('MDN：forEach 不等待 Promise', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach', '核对 forEach 期望同步回调且不等待 Promise；对照 for...of 与 map/all。')
])

add('js-fetch', [
    section('给网络请求画出三个可能失败的关口', [
        'fetch 返回 Response，表示获得响应状态和头，并不代表正文已经解析成功。第一关是请求能否获得响应，例如断网会拒绝；第二关是 HTTP 状态是否符合业务要求，例如 404 仍可得到 Response；第三关才是读取和解析正文，例如 200 返回 HTML 时 json() 仍会失败。',
        '下面不用真实服务器，用 Response 构造三种响应检验读取函数。把 status 和 json() 放到同一个逻辑里不会让错误消失，应让调用方明确处理。204 没有正文，若接口约定允许它，就需要单独设计返回值；本题约定成功响应为 JSON，因此空正文解析失败应继续传出，不自行发明空对象。'
    ], ['步骤：先检查 ok，再解析；对200 JSON、404 JSON、200坏JSON逐个写出通过和失败的关口。', '误区：response.json() 不是 JSON.parse(response)，它异步读取正文；读取后的同一响应体不能再随意重复读取。', '迁移练习：为真实接口加入“允许204”的业务分支，并在函数约定里写明它返回什么。'], code('''async function readJSON(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const cases = [
  new Response('{"ok":true}', { status: 200 }),
  new Response('{"error":"missing"}', { status: 404 }),
  new Response('不是JSON', { status: 200 })
];
Promise.all(cases.map(async response => {
  try { return JSON.stringify(await readJSON(response)); }
  catch (error) { return error.message.startsWith('HTTP') ? error.message : 'JSON解析失败'; }
})).then(result => console.log(result.join(' | ')));''', '输出 {"ok":true} | HTTP 404 | JSON解析失败。JSON引擎原始报错文本可能不同，例子统一显示分类。')),
    section('搜索框的旧响应为什么会覆盖新结果', [
        '用户先搜 a，再搜 ab，后一个请求可能先完成。若每个响应都直接改页面，较慢的 a 会把 ab 的结果覆盖，这叫响应竞态。取消旧请求可以减少无用工作，但界面还需要确认“这个结果是否仍属于当前输入”，例如用递增序号只允许最新请求提交结果。',
        'AbortController 的 signal 负责传递取消意图，不代表远端业务已经回滚，也不保证旧任务从未发生。被替换的搜索通常不必显示红色错误，但真正断网需要提示。界面加载状态同样应检查请求身份，否则旧请求的 finally 可能关掉新请求的 loading。'
    ], ['观察：把第一个搜索的完成按钮留到最后点击，验证旧结果没有覆盖最新结果。', '误区：每个 finally 都无条件关闭 loading，会让较新的请求仍在执行时显示“已完成”。', '迁移练习：在 fetchJSON 外层写搜索控制器，使用 signal 与请求序号；保持 fetchJSON 本身的通用错误契约。'])
], [
    choice('HTTP 200 的正文实际是 HTML，执行 await response.json() 会怎样？', ['只要200就一定得到对象', '可能因正文不是合法 JSON 而拒绝', '自动把HTML转换为JSON', '返回 Response 本身'], 1, 'HTTP 状态和正文格式是两个关口。json() 异步读取并解析正文；状态成功不保证格式正确，解析错误也需要向调用方传递。'),
    choice('搜索 a 的旧请求晚于 ab 完成，最可靠的页面更新条件是什么？', ['哪个后完成就展示哪个', '响应状态为200即可覆盖', '结果属于当前最新请求，再更新内容和加载状态', '所有请求共用一个无条件 finally 关闭 loading'], 2, '结果是否仍有效取决于请求身份，而不是完成时间。取消旧请求可配合减少工作，但页面提交和错误/加载状态仍应防止旧请求覆盖。')
], ['用 fetch 替身分别提供404、合法JSON、非法JSON、拒绝Promise，检查错误不会被空对象掩盖。', '记录替身收到的 options.signal，确认透传的是调用方传入的同一个信号。'], ['非JSON正文的解析异常与网络/取消异常均继续传出；HTTP失败错误包含原状态码。'], [
    ('MDN：fetch 状态、正文与取消', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch', '核对 HTTP 错误不自动拒绝、读取正文是第二异步阶段、正文不可重复消费与 AbortController。'),
    ('React：忽略过期网络结果', 'https://react.dev/learn/synchronizing-with-effects', '核对异步结果竞态需要取消或忽略过期结果；迁移为不依赖框架的搜索序号思考题。')
])

add('browser-events', [
    section('捕获、目标、冒泡是一条路径上的不同位置', [
        '点击按钮内的 span 时，event.target 通常是 span，祖先上的监听器却会依次获得同一次事件。捕获监听器从外向内遇到目标，随后可冒泡事件再向外传播；event.currentTarget 在每个监听器执行期间指向该监听器所在元素。不能拿 target 永远当按钮，也不能拿 currentTarget 当最初点击位置。',
        '下面把同一父容器的捕获监听器、按钮监听器和父容器冒泡监听器分开打印。先点击文字，再点击按钮留白，比较 target 与 currentTarget 的变化。示例使用脚本主动 click 来便于运行，真实指针点击也应亲自观察；影子DOM等更复杂场景还有重定向规则，本例只讨论普通DOM树。'
    ], ['步骤：预期顺序 capture、button、bubble；点span时三个监听器的target都指向span。', '误区：stopPropagation 阻止后续传播，不等于阻止同元素其他监听器，也不等于取消默认行为。', '迁移练习：改为在列表根节点委托点击，按钮里加入图标，仍准确定位所属按钮。'], code('''const outer = document.createElement('div');
const button = document.createElement('button');
const label = document.createElement('span');
label.textContent = '观察事件';
button.append(label); outer.append(button); document.body.append(outer);
outer.addEventListener('click', event => console.log('capture', event.target.tagName), true);
button.addEventListener('click', event => console.log('button', event.currentTarget.tagName));
outer.addEventListener('click', event => console.log('bubble', event.currentTarget.tagName));
label.click();''', '在HTML联动预览运行。输出 capture SPAN、button BUTTON、bubble DIV。')),
    section('取消默认行为和清理监听器都需要明确条件', [
        'preventDefault 只对可取消的事件生效；passive 监听器承诺不会取消默认行为，在其中调用也不会达到阻止滚动等目的。默认行为与传播是两套开关：取消链接跳转后，祖先的统计监听器仍可能运行。不要为了一个按钮动作，随意切断页面其他功能依赖的传播链。',
        'removeEventListener 需要相同的事件类型、函数引用和捕获标志。两次写外观相同的箭头表达式会得到两个函数，并不能互相解绑。对可能被重复挂载的组件，让注册函数返回 dispose，比到处重新拼写监听器更容易验证“卸载后不再响应”。'
    ], ['观察：挂载列表、添加新li、删除其内部图标所属条目，再执行dispose，确认点击不再删除。', '误区：addEventListener("click", () => work()) 和 removeEventListener("click", () => work()) 不是同一回调。', '迁移练习：给 attachDelete 的测试增加空白处点击、嵌套图标点击和解绑后点击三组行为。'])
], [
    choice('可取消的链接点击中调用 preventDefault，但没有停止传播，祖先冒泡监听器会怎样？', ['一定不执行', '通常仍执行，传播与默认行为分别控制', '被自动移到捕获阶段', '只能执行一次'], 1, 'preventDefault 取消默认动作，例如跳转；它不自动停止传播。祖先监听器是否运行还取决于其他传播控制和监听器状态。'),
    choice('下面为什么没有成功移除监听器？', ['click 不能移除', '两个箭头表达式产生不同函数引用', '必须刷新页面才生效', 'removeEventListener 需要Promise'], 1, '解绑要求匹配原回调引用和捕获标志。应保存 handler 后，把同一个 handler 用于注册和移除。', '''button.addEventListener('click', () => save());
button.removeEventListener('click', () => save());''')
], ['在注册后动态追加li再删除，证明不是给原有按钮逐个绑定。', '调用返回的解绑函数后再次点击，检查没有继续删除；重复解绑应无额外副作用。'], ['新增条目、按钮内嵌元素、非删除区域与解绑后的行为均按约定处理。'], [
    ('MDN：preventDefault 与事件传播', 'https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault', '核对取消默认行为不停止传播、不可取消事件与passive限制。'),
    ('MDN：移除监听器的匹配条件', 'https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener', '核对类型、同一函数引用和capture标志；不要求整个options对象相同。')
])

add('css-display', [
    section('Flex 的剩余空间，不是给每个孩子写百分比', [
        'Flex 把主轴上的可用空间交给项目协商。工具条中图标和按钮通常保留内容宽度，标题占剩余空间；如果给每个孩子固定百分比，再加 gap 和内边距，就容易超出容器。flex:1 让标题参与伸缩，但它默认的最小宽度还可能受长单词影响。',
        '下面给可伸缩标题 min-width:0，让它允许收缩；overflow-wrap:anywhere 则决定长字符串如何换行，两者解决的问题不同。先观察容器和项目边框，再输入没有空格的长链接，才能分辨“项目不肯变窄”和“文本不愿换行”。不要用全局 overflow:hidden 把溢出隐藏后就判定布局正确。'
    ], ['观察：将示例放入窄容器，删除min-width:0和overflow-wrap分别比较。', '误区：flex:1 不代表无条件忽略所有最小尺寸约束。', '迁移练习：把标题换成带行号的代码区，思考哪些区域应该横向滚动、哪些应该换行。'], code('''<style>
.toolbar { display:flex; gap:12px; width:100%; max-width:340px; border:1px solid; }
.toolbar .title { flex:1; min-width:0; overflow-wrap:anywhere; }
.toolbar button { flex:0 0 auto; }
</style>
<div class="toolbar">
  <span class="title">https://example.com/a-very-long-filename-without-spaces</span>
  <button type="button">保存</button>
</div>''', '在HTML预览中观察标题收缩换行，而按钮仍可点击。容器的尺寸与文本换行策略要分别检查。', 'html')),
    section('Grid 的轨道宽度和卡片内容一起验证', [
        'Grid 先定义行列轨道，再把项目放入单元格。两个 1fr 列表达分享剩余空间，但轨道默认最小值可能受内容影响；需要确实允许轨道缩小时，可用 minmax(0,1fr)。即使轨道缩小了，内部文本、图片和代码仍各自需要合适的换行或滚动规则。',
        '从两列切换成一列时，读者的阅读顺序仍应来自合理的HTML顺序，而不是只靠视觉排序掩盖结构。这里的媒体查询阈值是示例，可根据内容何时拥挤来调整，并非某台设备的专属尺寸。检验时至少看窄宽度、放大文字、长内容三种状态。'
    ], ['观察：给一张卡片加入长链接，再把容器变窄；检查页面整体是否出现不必要横向滚动。', '误区：border-box 包含padding和border，却不会把gap、margin自动算进孩子的指定width。', '迁移练习：为课程卡片制作两列到一列的布局，保持DOM阅读顺序并保证按钮不被挤出。'], code('''.cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.cards > article { min-width:0; overflow-wrap:anywhere; }
.cards pre { max-width:100%; overflow:auto; }
@media (max-width:36rem) { .cards { grid-template-columns:1fr; } }''', 'Grid控制轨道，卡片文字换行，pre自己滚动。该样式应用到 .cards 内的 article 卡片。', 'css'))
], [
    choice('Flex工具条中标题很长，flex:1仍把按钮挤出，首先该检查什么？', ['标题项目的最小宽度约束与文本换行策略', '按钮文字颜色', '把所有祖先设为display:none', '增加标题的固定width'], 0, '可伸缩项目可能受自动最小尺寸约束，min-width:0允许收缩，文本还需换行或局部滚动。直接隐藏溢出可能掩盖被裁掉的按钮。'),
    choice('两列Grid希望允许轨道收缩，同时处理长代码，哪种组合更合理？', ['仅用两个50%再加gap', 'minmax(0,1fr)定义轨道，并让代码容器局部overflow:auto', '给所有卡片固定1000px宽', '把正文全部缩小到8px'], 1, '轨道分配和内容溢出是不同层面。两个50%加gap可能超宽；允许轨道收缩后仍应为不可换行代码提供局部滚动。')
], ['给card放很长的文字，并用开发者工具测边框盒，区分内容溢出与盒子本身的240px。', '同时检查水平margin总占16px，但不要把它加进边框盒width。'], ['计算检查：边框盒240px、内容204px；左右margin另占16px，不通过裁剪来伪造尺寸正确。'], [
    ('MDN：min-width 的自动最小尺寸', 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/min-width', '核对flex/grid项目自动最小宽度受内容等条件影响，以及显式最小宽度的作用。'),
    ('MDN：Grid 的 minmax', 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/minmax', '核对minmax定义轨道下限与上限；示例分别控制轨道、文本与代码溢出。')
])

add('css-bfc', [
    section('用容器边框观察浮动究竟有没有被算进高度', [
        '一个只有浮动子元素的普通块容器，自动高度可能不包含这个浮动的高度，所以边框看上去缩成一条线。浮动仍然可以影响邻近文本环绕，并不是从页面彻底消失。给父容器设置固定高度只是让当前示例看起来正常，子元素增高后问题又会出现。',
        'display:flow-root 让父容器建立新的块级格式化上下文，自动高度会把内部浮动纳入计算。下例头像先用80px，再改120px；父容器应随之长高。若只想包含浮动，flow-root比顺手写overflow:hidden更能表达意图，也避免额外裁剪后代弹出内容。'
    ], ['步骤：先删除flow-root观察边框；恢复后改变avatar高度，检查父容器自动跟随。', '误区：overflow:hidden并不会普遍裁掉元素自己的外部阴影，但可能裁剪后代越界内容；要确认究竟是谁被裁剪。', '迁移练习：给头像增加一个越界的小徽标，确认包含浮动与是否允许视觉溢出是两个需求。'], code('''<style>
.profile { display:flow-root; border:2px solid #476; }
.avatar { float:left; width:80px; height:80px; margin-right:12px; background:#cde; }
</style>
<div class="profile"><div class="avatar">头像</div></div>
<p>这一段在容器后面。</p>''', '在HTML预览对比有无flow-root；父容器无需写死高度。只有浮动子元素的场景让差异更明显。', 'html')),
    section('边界阻止的是跨越边界的折叠', [
        '父子垂直外边距能否折叠，和内部两个兄弟之间能否折叠不是同一个问题。flow-root 可以阻止父容器与内部子元素的margin跨边界折叠，但内部普通流相邻块的垂直margin仍可能折叠。把BFC理解成“里面所有margin都相加”会在列表间距上得到错误预测。',
        '在下例中两个普通块分别有下边距20px和上边距12px，满足折叠条件时它们之间为20px，不是32px。若父容器改为flex列布局，这两个子项目的margin不按普通块相邻外边距规则折叠。先辨认布局模式，再决定应该用margin还是gap表达间距。'
    ], ['观察：先预测20px，再用开发者工具测量；将stack改为display:flex和flex-direction:column后重测。', '误区：只看到父元素建立BFC，就断言内部兄弟的外边距永不折叠。', '迁移练习：把段落列表改用flex列加gap，清零子项margin，比较哪一种更容易表达一致间距。'], code('''.stack { display:flow-root; }
.stack > div { height:20px; background:#cde; }
.stack > div:first-child { margin-bottom:20px; }
.stack > div + div { margin-top:12px; }''', '应用到 .stack 内相邻的两个普通div；没有其他干扰条件时中间间隔为20px。', 'css'))
], [
    choice('flow-root容器内两个相邻普通块，下margin为20px、上margin为12px，满足折叠条件时中间间隔是？', ['32px', '20px', '12px', '0px'], 1, '建立BFC阻止某些跨边界折叠，并不取消内部普通兄弟之间的垂直margin折叠；此处两个正外边距取较大值。'),
    choice('只含浮动头像的容器靠height:80px撑开，头像后来变120px，哪种修复更符合自动布局？', ['继续固定80px', '创建flow-root并移除不必要固定高度，再检查溢出', '给头像opacity:0', '只增大z-index'], 1, '目标是自动高度包含内部浮动，而不是为一张头像硬编码高度。flow-root能表达包含浮动的意图，尺寸变化后仍应验证。')
], ['把头像临时改高再恢复80px，确认父容器靠布局规则包含浮动，而非固定高度。', '检查没有为了解决浮动高度而添加隐藏越界内容的裁剪。'], ['父容器采用自动高度；不通过写死80px绕过浮动包含规则。'], [
    ('MDN：BFC包含浮动与折叠边界', 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Block_formatting_context', '核对flow-root包含内部浮动与父子边界折叠；明确内部相邻普通块仍按margin折叠条件分析。'),
    ('MDN：外边距折叠条件', 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Box_model/Margin_collapsing', '核对正外边距折叠取大值、flex/grid项目不按普通块margin折叠。')
])

add('react-state', [
    section('逐项处理更新队列，而不是修改当前变量', [
        '一次事件处理器看到的是本次渲染的状态快照。setCount(count+2)先用快照算出一个具体替换值；setCount(c=>c*3)则把更新函数排入队列，之后接收队列前一步的结果。混用二者时，应逐项推演：替换为多少、再变换为多少，而不是数setCount被调用了几次。',
        '下面假设本次count是1，第一步排入替换为3，第二步把3乘以3，第三步又排入由旧快照算出的2，因此最终为2。若把最后一步改成c=>c+1，最终才是10。更新函数应只计算新值，不做请求、弹窗或修改外部计数；开发检查可能重复调用它来发现不纯的行为。'
    ], ['步骤：手写队列表：1→替换3→变换9→替换2，再运行组件观察。', '误区：setCount不会同步改写当前闭包中的count，后续表达式仍使用同一渲染快照。', '迁移练习：为一次点击加五写函数式队列，并验证连续点击两次得到10。'], code('''// 位于React事件处理器中；这次渲染的count为1
setCount(count + 2);
setCount(c => c * 3);
setCount(count + 1);''', '这不是独立脚本：放入useState组件的点击处理器，最终显示2。函数式最后一步才会基于队列中的9继续加一。')),
    section('新数组不等于里面的对象都已经复制', [
        'React状态中的对象应按不可变方式更新。items.slice()或[...items]只创建新数组，里面每个对象引用仍指向原对象；接着next[0].done=true，仍然修改了旧状态里的对象。这样会破坏其他渲染快照或共享这些对象的界面，不能只检查外层数组是不是新引用。',
        '更新一项时，可以map生成新数组，对目标项使用对象展开产生新对象，其他未改项保留引用。只复制变化路径，不必为所有数据做深拷贝。下面使用函数式更新读取待处理状态，适合与其他更新排队；服务端返回数据也要先看契约，再决定替换还是合并。'
    ], ['观察：保存旧数组和目标对象引用，更新后检查旧对象字段没有变化、新目标对象引用不同。', '误区：展开语法是浅复制；新数组内的旧对象不会自动成为深层副本。', '迁移练习：给课程列表切换某一课的收藏，按id定位并只复制该项，保持其他项引用。'], code('''setItems(previous => previous.map(item =>
  item.id === targetId ? { ...item, done: !item.done } : item
));''', '用于React组件事件处理器。新数组和被修改项是新引用；未改项可复用引用，旧状态不被直接修改。'))
], [
    choice('本次count为1，下面同一事件处理器排队后最终count是多少？', ['10', '2', '9', '6'], 1, '替换3，更新函数乘3得9，最后count+1仍用本次快照1算出2，所以替换为2。若最后写c=>c+1才为10。', '''setCount(count + 2);
setCount(c => c * 3);
setCount(count + 1);'''),
    choice('const next=[...items]之后写next[0].done=true，为什么仍可能修改旧状态？', ['数组展开不会创建新数组', '展开是浅复制，next[0]与items[0]仍是同一个对象', 'React不支持数组', '布尔值不能作为状态'], 1, '外层数组复制不复制内部对象。应复制被修改项并生成新数组，而不是对共享对象直接赋值。')
], ['点击一次显示5，两次显示10；不要只测试初始0的一次点击。', '更新函数内只返回c+1；请求、日志统计等副作用放在适当的事件处理流程。'], ['更新函数保持纯净；连续多次点击仍每次增加5，不能依赖首次渲染的旧count。'], [
    ('React：状态更新队列', 'https://react.dev/learn/queueing-a-series-of-state-updates', '核对替换值和更新函数的队列处理、纯更新函数与本次快照不被set改写。'),
    ('React：不可变更新数组', 'https://react.dev/learn/updating-arrays-in-state', '核对数组展开为浅复制，更新嵌套对象需复制变化路径；原创收藏/完成状态练习。')
])

add('react-effects', [
    section('每次 setup 的资源，由那次 cleanup 收回', [
        'Effect用于让组件与外部系统保持同步，例如订阅频道。依赖变化时，旧Effect的清理先释放旧资源，新Effect再建立新资源。清理函数闭包保存的是那一次setup的输入，所以切换A→B时，应解除A的订阅，不是临时读取最新频道B再去取消。',
        '开发环境的Strict Mode可能额外执行setup→cleanup→setup来检查配对是否正确，不能靠一个“已经执行过”的ref跳过问题。正确目标是无论经历多少次建立与清理，当前都只有所需的一份订阅，卸载后不再接收消息。真实测试应统计注册与释放，而不只看页面是否出现一次消息。'
    ], ['步骤：记录subscribe(A)、unsubscribe(A)、subscribe(B)、unsubscribe(B)，最后一项发生在卸载。', '误区：依赖变化时清理旧资源，使用的是旧Effect自己的闭包，不应通过全局变量猜旧id。', '迁移练习：把订阅换成setInterval，确保更改周期和卸载时都clear对应的timer。'], code('''useEffect(() => {
  const unsubscribe = subscribe(channelId, message => {
    setMessage(message);
  });
  return () => unsubscribe();
}, [channelId, subscribe]);''', '放在React组件或自定义Hook中。每次setup返回的unsubscribe被该次cleanup捕获。')),
    section('清理异步任务时，同时决定是否接受旧结果', [
        '网络请求不一定能撤销已经完成的服务端处理，某些第三方异步接口也没有取消方法。组件切到新用户后，旧用户请求即使返回成功，也不应再覆盖当前界面。可以在每次Effect内定义有效标记，cleanup把它设为false，回调只在该次Effect仍有效时提交结果。',
        '依赖数组要反映Effect使用的响应式值，遗漏userId会导致界面停留在旧用户；随意加一个每次渲染都新建的对象又可能频繁重跑。先把同步目标和读到的值说清楚，再调整代码结构，不要靠关闭依赖检查让错误“消失”。纯粹过滤已有列表通常可以在渲染中计算，无需再用Effect保存一份重复状态。'
    ], ['观察：先切A再切B，故意让A最后返回，检查最终仍显示B；卸载后不再提交结果。', '误区：只在成功分支判断有效，错误分支不判断，旧请求仍可能覆盖新的错误提示。', '迁移练习：为loadProfile加入取消信号，并保留有效性检查；解释两者分别解决什么问题。'], code('''useEffect(() => {
  let active = true;
  setProfile(null);
  setError(null);
  loadProfile(userId).then(
    value => { if (active) setProfile(value); },
    error => { if (active) setError(error.message); }
  );
  return () => { active = false; };
}, [userId, loadProfile]);''', '用于React组件；loadProfile约定返回Promise。每次Effect拥有自己的active，旧成功与旧错误都被忽略。'))
], [
    choice('依赖从A变B，旧Effect返回的cleanup应释放哪份资源？', ['最新的B资源', '那一次setup建立的A资源', '两份资源都永不释放', '任意资源'], 1, 'cleanup闭包对应旧setup，先释放A，再建立B。把清理目标绑定到那次注册返回的句柄能避免清错新资源。'),
    choice('开发Strict Mode中出现setup→cleanup→setup，应该怎样验证订阅实现？', ['用ref跳过第二次setup就算修复', '删除cleanup减少调用', '检查每次注册都有对应清理，最终只有所需订阅', '省略全部依赖'], 2, '额外循环用于暴露不完整清理。目标是可重复建立/释放而不泄漏，不是阻止检查流程运行；生产行为不应依赖跳过一次setup。')
], ['用subscribe替身记录每次id与unsubscribe调用；切换频道、替换subscribe、卸载各测一次。', '旧订阅解除后不应继续推送；若真实订阅可能有在途消息，拓展时为回调增加有效标记。'], ['每个setup返回的unsubscribe在对应清理时调用，不误清理新频道，不遗留重复订阅。'], [
    ('React：Effect的同步、清理与竞态', 'https://react.dev/learn/synchronizing-with-effects', '核对依赖变化清理、开发StrictMode额外setup/cleanup、忽略过期请求结果与纯派生值不必使用Effect。')
])

add('vue-reactivity', [
    section('解构的是普通数值，还是到属性的连接', [
        'reactive返回代理对象。读取state.count时能经过代理，直接let {count}=state得到的却是当时的普通数值；后来给局部count重新赋值，不会回到代理属性。toRefs把已有属性映射为ref，使脚本通过count.value访问时仍连到state.count。',
        '这种“丢失连接”要看拿走的是什么。解构到一个嵌套代理对象后，继续改这个对象的属性仍可能触发响应；因此不能笼统背成“任何解构都不响应”。入门时先把普通数值、代理对象、ref三种变量标出来，再逐行说明读写走哪条路径。'
    ], ['步骤：标出snapshot为数值、count为ref；修改state.count，比较snapshot与count.value。', '误区：toRefs只为调用时已有的可枚举属性建立ref；需要单个属性连接时可了解toRef。', '迁移练习：把count传给子逻辑前，写明接口接收的是数值快照、ref还是getter。'], code('''<script setup>
import { reactive, toRefs } from 'vue';
const state = reactive({ count: 0 });
const snapshot = state.count;
const { count } = toRefs(state);
function increase() { state.count++; }
</script>
<template>
  <button @click="increase">增加</button>
  <p>快照：{{ snapshot }}；连接：{{ count }}</p>
</template>''', '这是Vue单文件组件，需Vue构建环境。点击后快照仍为0，模板中的顶层ref自动解包并显示新count。', 'html')),
    section('数据已经变了，DOM更新还需要等一个时机', [
        'Vue的响应式数据写入可以立刻读取到新值，但相关DOM更新会被缓冲，在下一次更新周期统一处理。因此state.count++后马上读取按钮textContent，可能仍看到旧文字。需要在DOM更新后测量或聚焦时，await nextTick，而不是随意猜一个setTimeout毫秒数。',
        '脚本中访问ref通常写.value，模板自动解包也有范围限制。顶层模板变量count很常见，但reactive数组里的ref不会因读取books[0]就自动解包。先确认所在位置和变量种类，再决定是否写.value；不要把模板便利规则推广到所有JavaScript表达式。'
    ], ['观察：在Vue组件中修改count后先读数据，再await nextTick读DOM，区分数据变化与渲染完成。', '误区：nextTick等待Vue本轮DOM更新，不代表所有网络请求、图片加载或浏览器绘制都已结束。', '迁移练习：点击展开输入框后await nextTick，再通过模板ref聚焦；解释直接focus为什么可能拿不到元素。'])
], [
    choice('在Vue3脚本中state为reactive对象，调用toRefs后修改state.count，count.value会怎样？', ['保持旧值', '读取到对应属性的新值', '永远是undefined', '必须重新调用toRefs'], 1, 'toRefs创建与已有属性关联的ref；它不是复制数值。直接解构基本类型才会得到与该属性读写断开的局部值。'),
    fill('Vue中修改响应式状态后，需要等待本轮DOM更新再测量，可 `await ____()`。', ['nextTick'], 'nextTick等待Vue的DOM更新刷新。数据本身不必等待才变更，它也不承诺全部网络请求或图片加载已经结束。')
], ['连续点击、通过state.count赋值、通过count.value赋值三种路径都应反映到同一状态。', '脚本里修改count.value，模板中使用顶层count；不要在模板里误把ref对象当普通数值参与脚本计算。'], ['保留state.count与解构ref的双向连接，不能只复制初始数值后维护两份独立计数。'], [
    ('Vue：响应性基础与DOM更新时机', 'https://vuejs.org/guide/essentials/reactivity-fundamentals.html', '核对reactive基本类型解构限制、nextTick、ref在数组与模板中的解包范围。'),
    ('Vue：toRefs属性连接', 'https://vuejs.org/api/reactivity-utilities.html#torefs', '核对toRefs连接原对象属性且仅转换调用时可枚举已有属性。')
])

add('browser-security', [
    section('纯文本输入，不能经过HTML解释这条路', [
        '用户输入的尖括号有时只是正常文字，有时包含攻击片段。安全显示纯文本不需要先猜它是不是“坏字符串”，而是选择不会把它解释为HTML的输出方式。textContent把完整字符串放成文本节点；innerHTML则让浏览器按HTML语法解析，这两条路径的安全含义不同。',
        '下面特意使用看起来像标签的昵称，验证页面显示原文字且没有创建img元素。不要先拼HTML再用几次replace删掉script标签，事件属性、URL等上下文会让手写过滤遗漏。若产品确实支持富文本，应采用维护中的净化方案并限定允许的结构；本题只要求纯文本，直接绕开HTML解析即可。'
    ], ['步骤：显示含尖括号、引号和&的输入；检查DOM里只有规定的文本容器，没有新增img或script。', '误区：把文本设进href、style或脚本字符串属于其他输出上下文，不能套用“已处理纯文本”就安全的结论。', '迁移练习：把评论作者名改成链接时，另外设计URL协议白名单，不把任意用户字符串直接当跳转地址。'], code('''const container = document.createElement('div');
document.body.append(container);
const payload = '<img src=x onerror="alert(1)"> & 你好';
const paragraph = document.createElement('p');
paragraph.textContent = payload;
container.append(paragraph);
console.log(container.querySelector('img') === null);
console.log(paragraph.textContent === payload);''', '在HTML联动预览运行，输出true、true；只显示标签字样，不创建图片或执行事件代码。')),
    section('服务器要验证操作意图，浏览器禁读不等于禁发', [
        'CSRF的关键是恶意页面诱导浏览器带着已有登录Cookie执行操作，而攻击者未必需要读取响应。CORS主要约束跨源脚本访问响应，并不能单独证明一项状态变更是用户主动发起的。把修改资料、删除数据设计成GET链接尤其危险：导航、图片等请求也可能被触发。',
        '服务端应结合具体架构验证CSRF token、请求来源或Fetch Metadata等，Cookie的SameSite可提供额外保护。HttpOnly限制脚本读取Cookie，但浏览器仍可自动携带它；HTTPS保护传输，也不自动检查用户意图。XSS与CSRF防护各有职责，不能把其中一个配置当成全部安全措施。'
    ], ['观察：把“能否发请求”“能否读响应”“服务端是否授权此操作”画成三个不同判断。', '误区：POST方法本身不是完整CSRF防护；普通跨站表单也可以发POST。', '迁移练习：为“修改邮箱”列出服务端验证步骤，并说明为什么前端隐藏按钮不是权限控制。'])
], [
    choice('只展示用户留言里的“<b>你好</b>”原文字，最直接的安全做法是什么？', ['拼进innerHTML后删script', '赋给textContent并保留原文字', '使用eval解析', '只要HTTPS就能直接innerHTML'], 1, '纯文本需求用textContent让浏览器不按HTML解析。手写黑名单容易漏掉其他可执行上下文，HTTPS也不改变DOM解释方式。'),
    choice('“攻击者读不到跨源响应，所以不能诱导登录用户改资料”这句话错在哪里？', ['所有跨源响应都公开', 'CSRF可能只需要发起携带凭据的操作，不必读取响应', 'Cookie永远不会自动发送', '只要POST就无需服务端验证'], 1, '响应可读性与请求是否能触发服务端副作用不同。需要针对状态变更验证来源或操作意图，而不能只依赖CORS、POST或HttpOnly。')
], ['测试作者和正文分别为标签字符串、空字符串、缺失字段，观察结构与字面内容。', '渲染后检查article内没有用户输入生成的img、script或事件属性。'], ['恶意样式的输入仍保留为文字；不能用删除危险字样代替正确的文本节点输出。'], [
    ('MDN：XSS与输出上下文', 'https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/XSS', '核对不可信输入解释为代码的风险、输出上下文与净化/编码责任。'),
    ('MDN：textContent与innerHTML区别', 'https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent', '核对textContent不进行HTML解析，纯文本输出示例为原创。'),
    ('MDN：CSRF的多层防护', 'https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF', '核对状态变更、SameSite非完整防护、token需服务端验证及跨站请求和读响应的区分。')
])

add('browser-cache', [
    section('同一个URL，先问保存，再问是否仍可直接复用', [
        '缓存策略可以分成三个问题：是否允许存储、谁可以存储、复用前是否需要验证。no-store要求标准HTTP缓存不要存储；private允许私有缓存但限制共享缓存；no-cache允许保存但每次复用前需要向源站验证。它们不在同一维度，不能当成简单的速度快慢排序。',
        'ETag是服务器给某个表示的版本标识，客户端在验证请求的If-None-Match里带回它。服务器判断未改变时返回304，客户端继续使用已有响应体；改变时返回200和新正文。304本身不是一份新的JSON正文。浏览器缓存层可能把验证过程处理后再交给fetch，网络面板状态和脚本读到的响应要区分。'
    ], ['步骤：首次200保存v2；验证携带v2得到304复用；资源变v3后验证得到200和新正文。', '误区：no-cache不是完全禁存；no-store也不会自动删除你程序自己保存在localStorage里的副本。', '迁移练习：分别为带内容hash的脚本、经常变的HTML入口、个人资料接口写缓存目标。'], code('''首次响应：
HTTP/1.1 200 OK
ETag: "v2"
Cache-Control: private, no-cache

hello

后续验证请求：
If-None-Match: "v2"

资源未变的响应：
HTTP/1.1 304 Not Modified
ETag: "v2"
（没有新的响应正文）''', '这是HTTP交互示意，不是在JS编辑器执行的代码。304让已有缓存复用之前的正文。', 'http')),
    section('缓存键要能区分真正不同的表示', [
        '同一个URL可能根据Accept-Language返回中文或日文。如果缓存只按URL复用，就可能给后来的日文请求发中文页面。Vary: Accept-Language告诉缓存：这个请求头参与选择对应副本。它不是让浏览器自动翻译，也不替代正文中语言的实际生成。',
        '对个性化内容更应谨慎区分共享与私有缓存，不能仅靠“URL相同就复用”。内容hash文件名适合发布新资源时换URL；HTML入口若长期不验证，则可能一直引用旧资源。缓存故障排查先写出URL、参与变化的请求头、版本标识和新鲜期，再决定清哪一层。'
    ], ['观察：相同URL配不同Accept-Language，检查响应语言和Vary；不要把返回语言错误归咎于浏览器字体。', '误区：Vary增加缓存区分维度，不等于开启身份鉴别；用户隐私数据仍要正确限制共享缓存。', '迁移练习：设计“HTML验证、带hash脚本长期缓存”的发布流程，解释为什么不需要每次把所有资源设no-store。'])
], [
    choice('接口按Accept-Language返回不同语言，同URL的缓存应如何区分？', ['只把响应文字颜色改掉', '响应声明Vary: Accept-Language，使对应请求头参与缓存区分', '所有请求强制复用首次正文', 'ETag永远固定相同值'], 1, 'Vary描述选择表示所依据的请求头；缓存不能仅凭URL把中文与日文响应混用。它不负责生成翻译，也不替代权限控制。'),
    choice('服务器返回304时，客户端要显示的正文通常来自哪里？', ['304里新传的一份完整正文', '之前已经存储、验证后可复用的响应体', '由ETag字符串自动解码生成', '一定为空白页面'], 1, '304表示条件验证未发现表示改变，没有新的完整正文；缓存复用之前保存的响应体。第一次没有可用副本时不能凭304生成页面。')
], ['检查缺失If-None-Match、精确"v2"、不同版本三种输入；注意双引号是标签字符串的一部分。', '304返回对象应没有body字段，200必须有hello；不要对304拼造空JSON。'], ['严格保留本题简化边界，不把未要求支持的标签列表或弱标签误判为匹配。'], [
    ('MDN：HTTP缓存、验证与Vary', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching', '核对private/no-cache/no-store、ETag与304复用流程、Accept-Language参与Vary缓存键。')
])

add('html-semantics', [
    section('一个输入框需要名字，也需要填写说明', [
        'label给输入框一个可见且可被辅助技术识别的名称，for应指向该输入的唯一id；name则决定表单提交字段名。id、name和placeholder承担不同职责，不能因为页面看起来有提示文字就互相替代。placeholder在输入后消失，不适合承担持续可见的字段说明。',
        '额外的格式提示或错误解释，可以通过aria-describedby关联到同页的说明元素，而不是塞进很长的label。下例保留清楚的“工作邮箱”名称，把用途说明单独放在旁边。HTML的type=email和required帮助常见格式与必填检查，但服务器仍须校验收到的值，浏览器表单校验不能充当安全边界。'
    ], ['步骤：点label确认焦点进入输入；只用Tab导航；清空后提交观察原生必填提示。', '误区：复制表单组件时重复id会破坏关联；name相同可表达提交字段，但id需在页面唯一。', '迁移练习：增加一个可见错误说明，并将其id加入aria-describedby；更正后恢复清楚的状态提示。'], code('''<form>
  <label for="work-email">工作邮箱</label>
  <input id="work-email" name="email" type="email" required
         autocomplete="email" aria-describedby="email-help">
  <p id="email-help">用于接收课程通知，不会公开展示。</p>
  <button type="submit">订阅</button>
  <button type="button">查看说明</button>
</form>''', '在HTML预览中用鼠标和键盘验证。label负责名称，说明段负责补充信息，两个按钮类型明确。', 'html')),
    section('可见焦点和合理顺序，让键盘用户知道自己在哪里', [
        '原生按钮和链接自带键盘交互，但若CSS无条件outline:none，键盘用户可能不知道当前焦点在哪。应提供清楚的:focus-visible样式，并在浅色、深色背景上检查对比与边缘是否被裁切。焦点状态不是装饰，它是下一次按Enter会触发哪个控件的重要提示。',
        'Tab顺序通常随文档中的可聚焦元素排列。为了视觉布局随意加正tabindex，会把导航顺序与内容结构拆开，维护更困难。优先写合理DOM顺序，再用布局实现视觉关系；长表单还要检查错误提示是否清楚关联到对应输入，而不是只靠红色标记。'
    ], ['观察：不用鼠标从页面开头走到订阅按钮，确认每一步都能看到焦点且没有隐藏控件截走焦点。', '误区：role="button"只描述角色，不会自动补齐Tab、Space、Enter和禁用行为。', '迁移练习：把只显示图标的帮助按钮加入表单，给它明确可访问名称并检查键盘激活。'], code('''button:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 3px solid #1857b6;
  outline-offset: 3px;
}''', 'CSS仅示范清晰焦点；应结合真实背景验证对比度，并保持DOM顺序与阅读顺序一致。', 'css'))
], [
    choice('label的for、input的id和name分别应怎样理解？', ['三个属性完全等价', 'for关联id，name用于提交字段名，id需在页面唯一', 'name控制字号，id只供CSS使用', '有placeholder就不需要label'], 1, '名称关联与提交键是不同职责。重复id会造成关联歧义；placeholder输入后会消失，不能完全替代可见label。'),
    fill('给输入框关联补充说明段落，可把说明段的id写入 `____` 属性。', ['aria-describedby'], 'aria-describedby引用同一文档中说明元素的id；它提供补充描述，不替代label的字段名称。', False)
], ['用鼠标点label、用Tab定位输入、空值提交和无效邮箱提交分别检查原生行为。', '增加“查看说明”操作时写type=button，避免误提交；保留提交按钮type=submit。'], ['页面内id唯一、label关联正确，键盘焦点可辨识；不可仅靠placeholder或颜色解释输入要求。'], [
    ('MDN：label的关联与唯一id', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label', '核对for/id显式关联、id文档唯一与label的交互用途。'),
    ('MDN：aria-describedby说明关联', 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby', '核对描述与名称区别、同文档id引用，不以说明替代label。'),
    ('MDN：键盘可访问性', 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Keyboard', '核对可见焦点、避免正tabindex重排与原生交互控件。')
])


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    data_files = {p: json.loads(p.read_text(encoding='utf-8')) for p in (ROOT / 'public/data').glob('*.json')}
    text_files = {p: json.loads(p.read_text(encoding='utf-8')) for p in (ROOT / 'public/textbook').glob('*.json')}
    lessons = {lesson['id']: lesson for rows in data_files.values() for lesson in rows}
    textbooks = {id: book for rows in text_files.values() for id, book in rows.items()}
    audit_path = ROOT / 'tests/fixtures/foundations-1.11-audit.json'
    if audit_path.exists():
        audit = json.loads(audit_path.read_text(encoding='utf-8'))
    else:
        audit = {'version': VERSION, 'verifiedAt': '2026-11-14', 'baseline': {}, 'lessons': {}}
        for id, lesson in lessons.items():
            book = textbooks[id]
            audit['baseline'][id] = {
                'sections': len(book['sections']),
                'paragraphs': sum(len(s['paragraphs']) for s in book['sections']),
                'paragraphCharacters': sum(len(p) for s in book['sections'] for p in s['paragraphs']),
                'sectionExamples': sum('code' in s for s in book['sections']),
                'questions': len(lesson['quiz']),
                'questionHashes': {q['id']: stable_hash(q) for q in lesson['quiz']},
                'sectionHashes': [stable_hash(s) for s in book['sections']],
                'challengeContractHash': stable_hash({k: lesson['challenge'][k] for k in ['title', 'description', 'starter', 'solution']})
            }
    for id, addition in ADDITIONS.items():
        lesson, book = lessons[id], textbooks[id]
        titles = {s['title'] for s in book['sections']}
        for s in addition['sections']:
            if s['title'] not in titles:
                book['sections'].append(s)
            else:
                index = next(i for i, old in enumerate(book['sections']) if old['title'] == s['title'])
                if index < audit['baseline'][id]['sections']:
                    raise ValueError(f'Refusing to replace legacy section: {id}/{s["title"]}')
                book['sections'][index] = s
        existing_ids = {q['id'] for q in lesson['quiz']}
        new_ids = []
        for number, question in enumerate(addition['questions'], 1):
            q = dict(question, id=f'{id}-v111-q{number}', introducedIn=VERSION)
            if id == 'js-async' and number == 2:
                q['codeOptions'] = [0, 1, 2, 3]
            new_ids.append(q['id'])
            if q['id'] not in existing_ids:
                lesson['quiz'].append(q)
            else:
                index = next(i for i, old in enumerate(lesson['quiz']) if old['id'] == q['id'])
                lesson['quiz'][index] = q
        for key in ['hints', 'rubric']:
            for value in addition[key]:
                if value not in lesson['challenge'][key]:
                    lesson['challenge'][key].append(value)
        urls = {r['url'] for r in lesson['references']}
        for title, url, note in addition['sources']:
            if url not in urls:
                lesson['references'].append({'title': title, 'url': url})
                urls.add(url)
        audit['lessons'][id] = {
            'addedSectionTitles': [s['title'] for s in addition['sections']],
            'addedQuestionIds': new_ids,
            'addedHints': addition['hints'], 'addedRubric': addition['rubric'],
            'sources': [{'title': title, 'url': url, 'checked': note} for title, url, note in addition['sources']]
        }
    for p, content in {**data_files, **text_files}.items():
        p.write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'lessons': len(ADDITIONS), 'addedSections': sum(len(a['sections']) for a in ADDITIONS.values()), 'addedQuestions': sum(len(a['questions']) for a in ADDITIONS.values()), 'totalQuestions': sum(len(l['quiz']) for l in lessons.values())}, ensure_ascii=False))


if __name__ == '__main__':
    main()
