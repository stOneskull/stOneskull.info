function noop() { }
const identity = x => x;
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
let src_url_equal_anchor;
function src_url_equal(element_src, url) {
    if (!src_url_equal_anchor) {
        src_url_equal_anchor = document.createElement('a');
    }
    src_url_equal_anchor.href = url;
    return element_src === src_url_equal_anchor.href;
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}

const is_client = typeof window !== 'undefined';
let now = is_client
    ? () => window.performance.now()
    : () => Date.now();
let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

const tasks = new Set();
function run_tasks(now) {
    tasks.forEach(task => {
        if (!task.c(now)) {
            tasks.delete(task);
            task.f();
        }
    });
    if (tasks.size !== 0)
        raf(run_tasks);
}
/**
 * Creates a new task that runs on each raf frame
 * until it returns a falsy value or is aborted
 */
function loop(callback) {
    let task;
    if (tasks.size === 0)
        raf(run_tasks);
    return {
        promise: new Promise(fulfill => {
            tasks.add(task = { c: callback, f: fulfill });
        }),
        abort() {
            tasks.delete(task);
        }
    };
}

// Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
// at the end of hydration without touching the remaining nodes.
let is_hydrating = false;
function start_hydrating() {
    is_hydrating = true;
}
function end_hydrating() {
    is_hydrating = false;
}
function upper_bound(low, high, key, value) {
    // Return first index of value larger than input value in the range [low, high)
    while (low < high) {
        const mid = low + ((high - low) >> 1);
        if (key(mid) <= value) {
            low = mid + 1;
        }
        else {
            high = mid;
        }
    }
    return low;
}
function init_hydrate(target) {
    if (target.hydrate_init)
        return;
    target.hydrate_init = true;
    // We know that all children have claim_order values since the unclaimed have been detached if target is not <head>
    let children = target.childNodes;
    // If target is <head>, there may be children without claim_order
    if (target.nodeName === 'HEAD') {
        const myChildren = [];
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (node.claim_order !== undefined) {
                myChildren.push(node);
            }
        }
        children = myChildren;
    }
    /*
    * Reorder claimed children optimally.
    * We can reorder claimed children optimally by finding the longest subsequence of
    * nodes that are already claimed in order and only moving the rest. The longest
    * subsequence of nodes that are claimed in order can be found by
    * computing the longest increasing subsequence of .claim_order values.
    *
    * This algorithm is optimal in generating the least amount of reorder operations
    * possible.
    *
    * Proof:
    * We know that, given a set of reordering operations, the nodes that do not move
    * always form an increasing subsequence, since they do not move among each other
    * meaning that they must be already ordered among each other. Thus, the maximal
    * set of nodes that do not move form a longest increasing subsequence.
    */
    // Compute longest increasing subsequence
    // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
    const m = new Int32Array(children.length + 1);
    // Predecessor indices + 1
    const p = new Int32Array(children.length);
    m[0] = -1;
    let longest = 0;
    for (let i = 0; i < children.length; i++) {
        const current = children[i].claim_order;
        // Find the largest subsequence length such that it ends in a value less than our current value
        // upper_bound returns first greater value, so we subtract one
        // with fast path for when we are on the current longest subsequence
        const seqLen = ((longest > 0 && children[m[longest]].claim_order <= current) ? longest + 1 : upper_bound(1, longest, idx => children[m[idx]].claim_order, current)) - 1;
        p[i] = m[seqLen] + 1;
        const newLen = seqLen + 1;
        // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
        m[newLen] = i;
        longest = Math.max(newLen, longest);
    }
    // The longest increasing subsequence of nodes (initially reversed)
    const lis = [];
    // The rest of the nodes, nodes that will be moved
    const toMove = [];
    let last = children.length - 1;
    for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
        lis.push(children[cur - 1]);
        for (; last >= cur; last--) {
            toMove.push(children[last]);
        }
        last--;
    }
    for (; last >= 0; last--) {
        toMove.push(children[last]);
    }
    lis.reverse();
    // We sort the nodes being moved to guarantee that their insertion order matches the claim order
    toMove.sort((a, b) => a.claim_order - b.claim_order);
    // Finally, we move the nodes
    for (let i = 0, j = 0; i < toMove.length; i++) {
        while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
            j++;
        }
        const anchor = j < lis.length ? lis[j] : null;
        target.insertBefore(toMove[i], anchor);
    }
}
function append(target, node) {
    target.appendChild(node);
}
function get_root_for_style(node) {
    if (!node)
        return document;
    const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    if (root && root.host) {
        return root;
    }
    return node.ownerDocument;
}
function append_empty_stylesheet(node) {
    const style_element = element('style');
    append_stylesheet(get_root_for_style(node), style_element);
    return style_element.sheet;
}
function append_stylesheet(node, style) {
    append(node.head || node, style);
    return style.sheet;
}
function append_hydration(target, node) {
    if (is_hydrating) {
        init_hydrate(target);
        if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentNode !== target))) {
            target.actual_end_child = target.firstChild;
        }
        // Skip nodes of undefined ordering
        while ((target.actual_end_child !== null) && (target.actual_end_child.claim_order === undefined)) {
            target.actual_end_child = target.actual_end_child.nextSibling;
        }
        if (node !== target.actual_end_child) {
            // We only insert if the ordering of this node should be modified or the parent node is not target
            if (node.claim_order !== undefined || node.parentNode !== target) {
                target.insertBefore(node, target.actual_end_child);
            }
        }
        else {
            target.actual_end_child = node.nextSibling;
        }
    }
    else if (node.parentNode !== target || node.nextSibling !== null) {
        target.appendChild(node);
    }
}
function insert_hydration(target, node, anchor) {
    if (is_hydrating && !anchor) {
        append_hydration(target, node);
    }
    else if (node.parentNode !== target || node.nextSibling != anchor) {
        target.insertBefore(node, anchor || null);
    }
}
function detach(node) {
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function init_claim_info(nodes) {
    if (nodes.claim_info === undefined) {
        nodes.claim_info = { last_index: 0, total_claimed: 0 };
    }
}
function claim_node(nodes, predicate, processNode, createNode, dontUpdateLastIndex = false) {
    // Try to find nodes in an order such that we lengthen the longest increasing subsequence
    init_claim_info(nodes);
    const resultNode = (() => {
        // We first try to find an element after the previous one
        for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                return node;
            }
        }
        // Otherwise, we try to find one before
        // We iterate in reverse so that we don't go too far back
        for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                else if (replacement === undefined) {
                    // Since we spliced before the last_index, we decrease it
                    nodes.claim_info.last_index--;
                }
                return node;
            }
        }
        // If we can't find any matching node, we create a new one
        return createNode();
    })();
    resultNode.claim_order = nodes.claim_info.total_claimed;
    nodes.claim_info.total_claimed += 1;
    return resultNode;
}
function claim_element_base(nodes, name, attributes, create_element) {
    return claim_node(nodes, (node) => node.nodeName === name, (node) => {
        const remove = [];
        for (let j = 0; j < node.attributes.length; j++) {
            const attribute = node.attributes[j];
            if (!attributes[attribute.name]) {
                remove.push(attribute.name);
            }
        }
        remove.forEach(v => node.removeAttribute(v));
        return undefined;
    }, () => create_element(name));
}
function claim_element(nodes, name, attributes) {
    return claim_element_base(nodes, name, attributes, element);
}
function claim_text(nodes, data) {
    return claim_node(nodes, (node) => node.nodeType === 3, (node) => {
        const dataStr = '' + data;
        if (node.data.startsWith(dataStr)) {
            if (node.data.length !== dataStr.length) {
                return node.splitText(dataStr.length);
            }
        }
        else {
            node.data = dataStr;
        }
    }, () => text(data), true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
    );
}
function claim_space(nodes) {
    return claim_text(nodes, ' ');
}
function set_data(text, data) {
    data = '' + data;
    if (text.data === data)
        return;
    text.data = data;
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, cancelable, detail);
    return e;
}
function head_selector(nodeId, head) {
    const result = [];
    let started = 0;
    for (const node of head.childNodes) {
        if (node.nodeType === 8 /* comment node */) {
            const comment = node.textContent.trim();
            if (comment === `HEAD_${nodeId}_END`) {
                started -= 1;
                result.push(node);
            }
            else if (comment === `HEAD_${nodeId}_START`) {
                started += 1;
                result.push(node);
            }
        }
        else if (started > 0) {
            result.push(node);
        }
    }
    return result;
}

// we need to store the information for multiple documents because a Svelte application could also contain iframes
// https://github.com/sveltejs/svelte/issues/3624
const managed_styles = new Map();
let active = 0;
// https://github.com/darkskyapp/string-hash/blob/master/index.js
function hash(str) {
    let hash = 5381;
    let i = str.length;
    while (i--)
        hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
    return hash >>> 0;
}
function create_style_information(doc, node) {
    const info = { stylesheet: append_empty_stylesheet(node), rules: {} };
    managed_styles.set(doc, info);
    return info;
}
function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
    const step = 16.666 / duration;
    let keyframes = '{\n';
    for (let p = 0; p <= 1; p += step) {
        const t = a + (b - a) * ease(p);
        keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
    }
    const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
    const name = `__svelte_${hash(rule)}_${uid}`;
    const doc = get_root_for_style(node);
    const { stylesheet, rules } = managed_styles.get(doc) || create_style_information(doc, node);
    if (!rules[name]) {
        rules[name] = true;
        stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
    }
    const animation = node.style.animation || '';
    node.style.animation = `${animation ? `${animation}, ` : ''}${name} ${duration}ms linear ${delay}ms 1 both`;
    active += 1;
    return name;
}
function delete_rule(node, name) {
    const previous = (node.style.animation || '').split(', ');
    const next = previous.filter(name
        ? anim => anim.indexOf(name) < 0 // remove specific animation
        : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
    );
    const deleted = previous.length - next.length;
    if (deleted) {
        node.style.animation = next.join(', ');
        active -= deleted;
        if (!active)
            clear_rules();
    }
}
function clear_rules() {
    raf(() => {
        if (active)
            return;
        managed_styles.forEach(info => {
            const { ownerNode } = info.stylesheet;
            // there is no ownerNode if it runs on jsdom.
            if (ownerNode)
                detach(ownerNode);
        });
        managed_styles.clear();
    });
}

let current_component;
function set_current_component(component) {
    current_component = component;
}

const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    // Do not reenter flush while dirty components are updated, as this can
    // result in an infinite loop. Instead, let the inner flush handle it.
    // Reentrancy is ok afterwards for bindings etc.
    if (flushidx !== 0) {
        return;
    }
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        try {
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
        }
        catch (e) {
            // reset dirty state to not end up in a deadlocked state and then rethrow
            dirty_components.length = 0;
            flushidx = 0;
            throw e;
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 */
function flush_render_callbacks(fns) {
    const filtered = [];
    const targets = [];
    render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
    targets.forEach((c) => c());
    render_callbacks = filtered;
}

let promise;
function wait() {
    if (!promise) {
        promise = Promise.resolve();
        promise.then(() => {
            promise = null;
        });
    }
    return promise;
}
function dispatch(node, direction, kind) {
    node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
    else if (callback) {
        callback();
    }
}
const null_transition = { duration: 0 };
function create_bidirectional_transition(node, fn, params, intro) {
    const options = { direction: 'both' };
    let config = fn(node, params, options);
    let t = intro ? 0 : 1;
    let running_program = null;
    let pending_program = null;
    let animation_name = null;
    function clear_animation() {
        if (animation_name)
            delete_rule(node, animation_name);
    }
    function init(program, duration) {
        const d = (program.b - t);
        duration *= Math.abs(d);
        return {
            a: t,
            b: program.b,
            d,
            duration,
            start: program.start,
            end: program.start + duration,
            group: program.group
        };
    }
    function go(b) {
        const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
        const program = {
            start: now() + delay,
            b
        };
        if (!b) {
            // @ts-ignore todo: improve typings
            program.group = outros;
            outros.r += 1;
        }
        if (running_program || pending_program) {
            pending_program = program;
        }
        else {
            // if this is an intro, and there's a delay, we need to do
            // an initial tick and/or apply CSS animation immediately
            if (css) {
                clear_animation();
                animation_name = create_rule(node, t, b, duration, delay, easing, css);
            }
            if (b)
                tick(0, 1);
            running_program = init(program, duration);
            add_render_callback(() => dispatch(node, b, 'start'));
            loop(now => {
                if (pending_program && now > pending_program.start) {
                    running_program = init(pending_program, duration);
                    pending_program = null;
                    dispatch(node, running_program.b, 'start');
                    if (css) {
                        clear_animation();
                        animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                    }
                }
                if (running_program) {
                    if (now >= running_program.end) {
                        tick(t = running_program.b, 1 - t);
                        dispatch(node, running_program.b, 'end');
                        if (!pending_program) {
                            // we're done
                            if (running_program.b) {
                                // intro — we can tidy up immediately
                                clear_animation();
                            }
                            else {
                                // outro — needs to be coordinated
                                if (!--running_program.group.r)
                                    run_all(running_program.group.c);
                            }
                        }
                        running_program = null;
                    }
                    else if (now >= running_program.start) {
                        const p = now - running_program.start;
                        t = running_program.a + running_program.d * easing(p / running_program.duration);
                        tick(t, 1 - t);
                    }
                }
                return !!(running_program || pending_program);
            });
        }
    }
    return {
        run(b) {
            if (is_function(config)) {
                wait().then(() => {
                    // @ts-ignore
                    config = config(options);
                    go(b);
                });
            }
            else {
                go(b);
            }
        },
        end() {
            clear_animation();
            running_program = pending_program = null;
        }
    };
}
function create_component(block) {
    block && block.c();
}
function claim_component(block, parent_nodes) {
    block && block.l(parent_nodes);
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
            // if the component was destroyed immediately
            // it will update the `$$.on_destroy` reference to `null`.
            // the destructured on_destroy may still reference to the old array
            if (component.$$.on_destroy) {
                component.$$.on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        flush_render_callbacks($$.after_update);
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: [],
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            start_hydrating();
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        end_hydrating();
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        if (!is_function(callback)) {
            return noop;
        }
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

/* generated by Svelte v3.58.0 */

function create_if_block(ctx) {
	let meta0;
	let meta0_content_value;
	let t;
	let meta1;
	let meta1_content_value;

	return {
		c() {
			meta0 = element("meta");
			t = space();
			meta1 = element("meta");
			this.h();
		},
		l(nodes) {
			meta0 = claim_element(nodes, "META", { property: true, content: true });
			t = claim_space(nodes);
			meta1 = claim_element(nodes, "META", { name: true, content: true });
			this.h();
		},
		h() {
			attr(meta0, "property", "og:image");
			attr(meta0, "content", meta0_content_value = /*image*/ ctx[1].url);
			attr(meta1, "name", "twitter:image");
			attr(meta1, "content", meta1_content_value = /*image*/ ctx[1].url);
		},
		m(target, anchor) {
			insert_hydration(target, meta0, anchor);
			insert_hydration(target, t, anchor);
			insert_hydration(target, meta1, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*image*/ 2 && meta0_content_value !== (meta0_content_value = /*image*/ ctx[1].url)) {
				attr(meta0, "content", meta0_content_value);
			}

			if (dirty & /*image*/ 2 && meta1_content_value !== (meta1_content_value = /*image*/ ctx[1].url)) {
				attr(meta1, "content", meta1_content_value);
			}
		},
		d(detaching) {
			if (detaching) detach(meta0);
			if (detaching) detach(t);
			if (detaching) detach(meta1);
		}
	};
}

function create_fragment(ctx) {
	let meta0;
	let link;
	let link_href_value;
	let title_value;
	let meta1;
	let style;
	let t;
	document.title = title_value = /*title*/ ctx[2];
	let if_block = /*image*/ ctx[1].url && create_if_block(ctx);

	return {
		c() {
			meta0 = element("meta");
			link = element("link");
			meta1 = element("meta");
			if (if_block) if_block.c();
			style = element("style");
			t = text("@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n\n#page {\n  font-family: system-ui, sans-serif;\n  color: var(--color);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\n.button {\n  color: white;\n  background: var(--color-accent);\n  border-radius: 5px;\n  padding: 8px 20px;\n  transition: var(--transition);\n}\n\n.button:hover {\n    box-shadow: 0 0 10px 5px rgba(0, 0, 0, 0.1);\n  }\n\n.button.inverted {\n    background: transparent; \n    color: var(--color-accent); \n    border: 2px solid var(--color-accent);\n  }");
			this.h();
		},
		l(nodes) {
			const head_nodes = head_selector('svelte-1cn3rtl', document.head);
			meta0 = claim_element(head_nodes, "META", { name: true, content: true });

			link = claim_element(head_nodes, "LINK", {
				rel: true,
				type: true,
				sizes: true,
				href: true
			});

			meta1 = claim_element(head_nodes, "META", { name: true, content: true });
			if (if_block) if_block.l(head_nodes);
			style = claim_element(head_nodes, "STYLE", {});
			var style_nodes = children(style);
			t = claim_text(style_nodes, "@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n\n#page {\n  font-family: system-ui, sans-serif;\n  color: var(--color);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\n.button {\n  color: white;\n  background: var(--color-accent);\n  border-radius: 5px;\n  padding: 8px 20px;\n  transition: var(--transition);\n}\n\n.button:hover {\n    box-shadow: 0 0 10px 5px rgba(0, 0, 0, 0.1);\n  }\n\n.button.inverted {\n    background: transparent; \n    color: var(--color-accent); \n    border: 2px solid var(--color-accent);\n  }");
			style_nodes.forEach(detach);
			head_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(meta0, "name", "viewport");
			attr(meta0, "content", "width=device-width, initial-scale=1.0");
			attr(link, "rel", "icon");
			attr(link, "type", "image/png");
			attr(link, "sizes", "32x32");
			attr(link, "href", link_href_value = /*favicon*/ ctx[0].url);
			attr(meta1, "name", "description");
			attr(meta1, "content", /*description*/ ctx[3]);
		},
		m(target, anchor) {
			append_hydration(document.head, meta0);
			append_hydration(document.head, link);
			append_hydration(document.head, meta1);
			if (if_block) if_block.m(document.head, null);
			append_hydration(document.head, style);
			append_hydration(style, t);
		},
		p(ctx, [dirty]) {
			if (dirty & /*favicon*/ 1 && link_href_value !== (link_href_value = /*favicon*/ ctx[0].url)) {
				attr(link, "href", link_href_value);
			}

			if (dirty & /*title*/ 4 && title_value !== (title_value = /*title*/ ctx[2])) {
				document.title = title_value;
			}

			if (dirty & /*description*/ 8) {
				attr(meta1, "content", /*description*/ ctx[3]);
			}

			if (/*image*/ ctx[1].url) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(style.parentNode, style);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			detach(meta0);
			detach(link);
			detach(meta1);
			if (if_block) if_block.d(detaching);
			detach(style);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let { favicon } = $$props;
	let { image } = $$props;
	let { title } = $$props;
	let { description } = $$props;

	$$self.$$set = $$props => {
		if ('favicon' in $$props) $$invalidate(0, favicon = $$props.favicon);
		if ('image' in $$props) $$invalidate(1, image = $$props.image);
		if ('title' in $$props) $$invalidate(2, title = $$props.title);
		if ('description' in $$props) $$invalidate(3, description = $$props.description);
	};

	return [favicon, image, title, description];
}

class Component extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance, create_fragment, safe_not_equal, {
			favicon: 0,
			image: 1,
			title: 2,
			description: 3
		});
	}
}

function fade(node, { delay = 0, duration = 400, easing = identity } = {}) {
    const o = +getComputedStyle(node).opacity;
    return {
        delay,
        duration,
        easing,
        css: t => `opacity: ${t * o}`
    };
}

/* generated by Svelte v3.58.0 */

function create_fragment$1(ctx) {
	let t;

	return {
		c() {
			t = text("/*\n * [Package Error] \"@iconify/svelte@v4.0.2\" could not be built. \n *\n *   [1/5] Verifying package is valid…\n *   [2/5] Installing dependencies from npm…\n *   [3/5] Building package using esinstall…\n *   Running esinstall...\n *   ENOENT: no such file or directory, open '@iconify/svelte/lib/dist/functions.js'\n *   ENOENT: no such file or directory, open '/tmp/cdn/_BTFodksBdDZ1BXxNOZpr/node_modules/@iconify/svelte/lib/dist/functions.js'\n *\n * How to fix:\n *   - If you believe this to be an error in Skypack, file an issue here: https://github.com/skypackjs/skypack-cdn/issues\n *   - If you believe this to be an issue in the package, share this URL with the package authors to help them debug & fix.\n *   - Use https://skypack.dev/ to find a web-friendly alternative to find another package.\n */\n\nconsole.warn(\"[Package Error] \\\"@iconify/svelte@v4.0.2\\\" could not be built. \\n[1/5] Verifying package is valid…\\n[2/5] Installing dependencies from npm…\\n[3/5] Building package using esinstall…\\nRunning esinstall...\\nENOENT: no such file or directory, open '@iconify/svelte/lib/dist/functions.js'\\nENOENT: no such file or directory, open '/tmp/cdn/_BTFodksBdDZ1BXxNOZpr/node_modules/@iconify/svelte/lib/dist/functions.js'\");\nthrow new Error(\"[Package Error] \\\"@iconify/svelte@v4.0.2\\\" could not be built. \");\nexport default null;");
		},
		l(nodes) {
			t = claim_text(nodes, "/*\n * [Package Error] \"@iconify/svelte@v4.0.2\" could not be built. \n *\n *   [1/5] Verifying package is valid…\n *   [2/5] Installing dependencies from npm…\n *   [3/5] Building package using esinstall…\n *   Running esinstall...\n *   ENOENT: no such file or directory, open '@iconify/svelte/lib/dist/functions.js'\n *   ENOENT: no such file or directory, open '/tmp/cdn/_BTFodksBdDZ1BXxNOZpr/node_modules/@iconify/svelte/lib/dist/functions.js'\n *\n * How to fix:\n *   - If you believe this to be an error in Skypack, file an issue here: https://github.com/skypackjs/skypack-cdn/issues\n *   - If you believe this to be an issue in the package, share this URL with the package authors to help them debug & fix.\n *   - Use https://skypack.dev/ to find a web-friendly alternative to find another package.\n */\n\nconsole.warn(\"[Package Error] \\\"@iconify/svelte@v4.0.2\\\" could not be built. \\n[1/5] Verifying package is valid…\\n[2/5] Installing dependencies from npm…\\n[3/5] Building package using esinstall…\\nRunning esinstall...\\nENOENT: no such file or directory, open '@iconify/svelte/lib/dist/functions.js'\\nENOENT: no such file or directory, open '/tmp/cdn/_BTFodksBdDZ1BXxNOZpr/node_modules/@iconify/svelte/lib/dist/functions.js'\");\nthrow new Error(\"[Package Error] \\\"@iconify/svelte@v4.0.2\\\" could not be built. \");\nexport default null;");
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

class Component$1 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment$1, safe_not_equal, {});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[10] = list[i].link;
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[10] = list[i].link;
	return child_ctx;
}

// (107:31) 
function create_if_block_4(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[0].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 1 && img_alt_value !== (img_alt_value = /*logo*/ ctx[0].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (105:6) {#if logo.title}
function create_if_block_3(ctx) {
	let t_value = /*logo*/ ctx[0].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && t_value !== (t_value = /*logo*/ ctx[0].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (112:6) {#each site_nav as { link }}
function create_each_block_1(ctx) {
	let a;
	let t_value = /*link*/ ctx[10].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-1grguq5");
			attr(a, "href", a_href_value = /*link*/ ctx[10].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2 && t_value !== (t_value = /*link*/ ctx[10].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[10].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (121:31) 
function create_if_block_2(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[0].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[0].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 1 && img_alt_value !== (img_alt_value = /*logo*/ ctx[0].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (119:6) {#if logo.title}
function create_if_block_1(ctx) {
	let t_value = /*logo*/ ctx[0].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 1 && t_value !== (t_value = /*logo*/ ctx[0].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (131:4) {#if mobileNavOpen}
function create_if_block$1(ctx) {
	let nav;
	let t;
	let button;
	let icon;
	let nav_transition;
	let current;
	let mounted;
	let dispose;
	let each_value = /*site_nav*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	icon = new Component$1({ props: { height: "25", icon: "bi:x-lg" } });

	return {
		c() {
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			button = element("button");
			create_component(icon.$$.fragment);
			this.h();
		},
		l(nodes) {
			nav = claim_element(nodes, "NAV", { id: true, class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			t = claim_space(nav_nodes);

			button = claim_element(nav_nodes, "BUTTON", {
				id: true,
				"aria-label": true,
				class: true
			});

			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			nav_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(button, "id", "close");
			attr(button, "aria-label", "Close Navigation");
			attr(button, "class", "svelte-1grguq5");
			attr(nav, "id", "popup");
			attr(nav, "class", "svelte-1grguq5");
		},
		m(target, anchor) {
			insert_hydration(target, nav, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(nav, t);
			append_hydration(nav, button);
			mount_component(icon, button, null);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler_1*/ ctx[8]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2) {
				each_value = /*site_nav*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, t);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);

			add_render_callback(() => {
				if (!current) return;
				if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, true);
				nav_transition.run(1);
			});

			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, false);
			nav_transition.run(0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(nav);
			destroy_each(each_blocks, detaching);
			destroy_component(icon);
			if (detaching && nav_transition) nav_transition.end();
			mounted = false;
			dispose();
		}
	};
}

// (133:8) {#each site_nav as { link }}
function create_each_block(ctx) {
	let a;
	let t_value = /*link*/ ctx[10].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[10].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 2 && t_value !== (t_value = /*link*/ ctx[10].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[10].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

function create_fragment$2(ctx) {
	let div2;
	let header;
	let div0;
	let a0;
	let t0;
	let nav;
	let t1;
	let div1;
	let a1;
	let t2;
	let button;
	let icon;
	let t3;
	let current;
	let mounted;
	let dispose;

	function select_block_type(ctx, dirty) {
		if (/*logo*/ ctx[0].title) return create_if_block_3;
		if (/*logo*/ ctx[0].image.url) return create_if_block_4;
	}

	let current_block_type = select_block_type(ctx);
	let if_block0 = current_block_type && current_block_type(ctx);
	let each_value_1 = /*site_nav*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	function select_block_type_1(ctx, dirty) {
		if (/*logo*/ ctx[0].title) return create_if_block_1;
		if (/*logo*/ ctx[0].image.url) return create_if_block_2;
	}

	let current_block_type_1 = select_block_type_1(ctx);
	let if_block1 = current_block_type_1 && current_block_type_1(ctx);

	icon = new Component$1({
			props: { height: "30", icon: "eva:menu-outline" }
		});

	let if_block2 = /*mobileNavOpen*/ ctx[2] && create_if_block$1(ctx);

	return {
		c() {
			div2 = element("div");
			header = element("header");
			div0 = element("div");
			a0 = element("a");
			if (if_block0) if_block0.c();
			t0 = space();
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t1 = space();
			div1 = element("div");
			a1 = element("a");
			if (if_block1) if_block1.c();
			t2 = space();
			button = element("button");
			create_component(icon.$$.fragment);
			t3 = space();
			if (if_block2) if_block2.c();
			this.h();
		},
		l(nodes) {
			div2 = claim_element(nodes, "DIV", { class: true, id: true });
			var div2_nodes = children(div2);
			header = claim_element(div2_nodes, "HEADER", { class: true });
			var header_nodes = children(header);
			div0 = claim_element(header_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			a0 = claim_element(div0_nodes, "A", { href: true, class: true });
			var a0_nodes = children(a0);
			if (if_block0) if_block0.l(a0_nodes);
			a0_nodes.forEach(detach);
			t0 = claim_space(div0_nodes);
			nav = claim_element(div0_nodes, "NAV", { class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			nav_nodes.forEach(detach);
			div0_nodes.forEach(detach);
			t1 = claim_space(header_nodes);
			div1 = claim_element(header_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			a1 = claim_element(div1_nodes, "A", { href: true, class: true });
			var a1_nodes = children(a1);
			if (if_block1) if_block1.l(a1_nodes);
			a1_nodes.forEach(detach);
			t2 = claim_space(div1_nodes);
			button = claim_element(div1_nodes, "BUTTON", { id: true, "aria-label": true });
			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			t3 = claim_space(div1_nodes);
			if (if_block2) if_block2.l(div1_nodes);
			div1_nodes.forEach(detach);
			header_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a0, "href", "/");
			attr(a0, "class", "logo svelte-1grguq5");
			attr(nav, "class", "svelte-1grguq5");
			attr(div0, "class", "desktop-nav svelte-1grguq5");
			attr(a1, "href", "/");
			attr(a1, "class", "logo svelte-1grguq5");
			attr(button, "id", "open");
			attr(button, "aria-label", "Open mobile navigation");
			attr(div1, "class", "mobile-nav svelte-1grguq5");
			attr(header, "class", "section-container svelte-1grguq5");
			attr(div2, "class", "section");
			attr(div2, "id", "section-9c5fccaf");
		},
		m(target, anchor) {
			insert_hydration(target, div2, anchor);
			append_hydration(div2, header);
			append_hydration(header, div0);
			append_hydration(div0, a0);
			if (if_block0) if_block0.m(a0, null);
			append_hydration(div0, t0);
			append_hydration(div0, nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(header, t1);
			append_hydration(header, div1);
			append_hydration(div1, a1);
			if (if_block1) if_block1.m(a1, null);
			append_hydration(div1, t2);
			append_hydration(div1, button);
			mount_component(icon, button, null);
			append_hydration(div1, t3);
			if (if_block2) if_block2.m(div1, null);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler*/ ctx[7]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
				if_block0.p(ctx, dirty);
			} else {
				if (if_block0) if_block0.d(1);
				if_block0 = current_block_type && current_block_type(ctx);

				if (if_block0) {
					if_block0.c();
					if_block0.m(a0, null);
				}
			}

			if (dirty & /*site_nav*/ 2) {
				each_value_1 = /*site_nav*/ ctx[1];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_1.length;
			}

			if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx)) && if_block1) {
				if_block1.p(ctx, dirty);
			} else {
				if (if_block1) if_block1.d(1);
				if_block1 = current_block_type_1 && current_block_type_1(ctx);

				if (if_block1) {
					if_block1.c();
					if_block1.m(a1, null);
				}
			}

			if (/*mobileNavOpen*/ ctx[2]) {
				if (if_block2) {
					if_block2.p(ctx, dirty);

					if (dirty & /*mobileNavOpen*/ 4) {
						transition_in(if_block2, 1);
					}
				} else {
					if_block2 = create_if_block$1(ctx);
					if_block2.c();
					transition_in(if_block2, 1);
					if_block2.m(div1, null);
				}
			} else if (if_block2) {
				group_outros();

				transition_out(if_block2, 1, 1, () => {
					if_block2 = null;
				});

				check_outros();
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			transition_in(if_block2);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			transition_out(if_block2);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);

			if (if_block0) {
				if_block0.d();
			}

			destroy_each(each_blocks, detaching);

			if (if_block1) {
				if_block1.d();
			}

			destroy_component(icon);
			if (if_block2) if_block2.d();
			mounted = false;
			dispose();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { favicon } = $$props;
	let { image } = $$props;
	let { title } = $$props;
	let { description } = $$props;
	let { logo } = $$props;
	let { site_nav } = $$props;
	let mobileNavOpen = false;

	const click_handler = () => $$invalidate(2, mobileNavOpen = true);
	const click_handler_1 = () => $$invalidate(2, mobileNavOpen = false);

	$$self.$$set = $$props => {
		if ('favicon' in $$props) $$invalidate(3, favicon = $$props.favicon);
		if ('image' in $$props) $$invalidate(4, image = $$props.image);
		if ('title' in $$props) $$invalidate(5, title = $$props.title);
		if ('description' in $$props) $$invalidate(6, description = $$props.description);
		if ('logo' in $$props) $$invalidate(0, logo = $$props.logo);
		if ('site_nav' in $$props) $$invalidate(1, site_nav = $$props.site_nav);
	};

	return [
		logo,
		site_nav,
		mobileNavOpen,
		favicon,
		image,
		title,
		description,
		click_handler,
		click_handler_1
	];
}

class Component$2 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$1, create_fragment$2, safe_not_equal, {
			favicon: 3,
			image: 4,
			title: 5,
			description: 6,
			logo: 0,
			site_nav: 1
		});
	}
}

/* generated by Svelte v3.58.0 */

function create_fragment$3(ctx) {
	let div2;
	let div1;
	let div0;
	let raw_value = /*content*/ ctx[0].html + "";

	return {
		c() {
			div2 = element("div");
			div1 = element("div");
			div0 = element("div");
			this.h();
		},
		l(nodes) {
			div2 = claim_element(nodes, "DIV", { class: true, id: true });
			var div2_nodes = children(div2);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			div0 = claim_element(div1_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			div0_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div0, "class", "section-container content svelte-z64qd0");
			attr(div1, "class", "section");
			attr(div2, "class", "section");
			attr(div2, "id", "section-2db230c1");
		},
		m(target, anchor) {
			insert_hydration(target, div2, anchor);
			append_hydration(div2, div1);
			append_hydration(div1, div0);
			div0.innerHTML = raw_value;
		},
		p(ctx, [dirty]) {
			if (dirty & /*content*/ 1 && raw_value !== (raw_value = /*content*/ ctx[0].html + "")) div0.innerHTML = raw_value;		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div2);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { favicon } = $$props;
	let { image } = $$props;
	let { title } = $$props;
	let { description } = $$props;
	let { content } = $$props;

	$$self.$$set = $$props => {
		if ('favicon' in $$props) $$invalidate(1, favicon = $$props.favicon);
		if ('image' in $$props) $$invalidate(2, image = $$props.image);
		if ('title' in $$props) $$invalidate(3, title = $$props.title);
		if ('description' in $$props) $$invalidate(4, description = $$props.description);
		if ('content' in $$props) $$invalidate(0, content = $$props.content);
	};

	return [content, favicon, image, title, description];
}

class Component$3 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$2, create_fragment$3, safe_not_equal, {
			favicon: 1,
			image: 2,
			title: 3,
			description: 4,
			content: 0
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[6] = list[i].link;
	child_ctx[7] = list[i].icon;
	return child_ctx;
}

function get_each_context_1$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[6] = list[i].link;
	return child_ctx;
}

// (68:4) {#each nav as { link }}
function create_each_block_1$1(ctx) {
	let a;
	let t_value = /*link*/ ctx[6].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-i9k4w2");
			attr(a, "href", a_href_value = /*link*/ ctx[6].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*nav*/ 1 && t_value !== (t_value = /*link*/ ctx[6].label + "")) set_data(t, t_value);

			if (dirty & /*nav*/ 1 && a_href_value !== (a_href_value = /*link*/ ctx[6].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (74:4) {#each social as { link, icon }}
function create_each_block$1(ctx) {
	let a;
	let icon;
	let t;
	let a_href_value;
	let a_aria_label_value;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[7] } });

	return {
		c() {
			a = element("a");
			create_component(icon.$$.fragment);
			t = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", {
				href: true,
				"aria-label": true,
				class: true
			});

			var a_nodes = children(a);
			claim_component(icon.$$.fragment, a_nodes);
			t = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[6].url);
			attr(a, "aria-label", a_aria_label_value = /*link*/ ctx[6].label);
			attr(a, "class", "svelte-i9k4w2");
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			mount_component(icon, a, null);
			append_hydration(a, t);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*social*/ 2) icon_changes.icon = /*icon*/ ctx[7];
			icon.$set(icon_changes);

			if (!current || dirty & /*social*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[6].url)) {
				attr(a, "href", a_href_value);
			}

			if (!current || dirty & /*social*/ 2 && a_aria_label_value !== (a_aria_label_value = /*link*/ ctx[6].label)) {
				attr(a, "aria-label", a_aria_label_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

function create_fragment$4(ctx) {
	let div1;
	let footer;
	let nav_1;
	let t;
	let div0;
	let current;
	let each_value_1 = /*nav*/ ctx[0];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
	}

	let each_value = /*social*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div1 = element("div");
			footer = element("footer");
			nav_1 = element("nav");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t = space();
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			footer = claim_element(div1_nodes, "FOOTER", { class: true });
			var footer_nodes = children(footer);
			nav_1 = claim_element(footer_nodes, "NAV", { class: true });
			var nav_1_nodes = children(nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(nav_1_nodes);
			}

			nav_1_nodes.forEach(detach);
			t = claim_space(footer_nodes);
			div0 = claim_element(footer_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div0_nodes);
			}

			div0_nodes.forEach(detach);
			footer_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(nav_1, "class", "svelte-i9k4w2");
			attr(div0, "class", "social-links svelte-i9k4w2");
			attr(footer, "class", "section-container svelte-i9k4w2");
			attr(div1, "class", "section");
			attr(div1, "id", "section-2f8c9b27");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, footer);
			append_hydration(footer, nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(nav_1, null);
				}
			}

			append_hydration(footer, t);
			append_hydration(footer, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div0, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (dirty & /*nav*/ 1) {
				each_value_1 = /*nav*/ ctx[0];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
					} else {
						each_blocks_1[i] = create_each_block_1$1(child_ctx);
						each_blocks_1[i].c();
						each_blocks_1[i].m(nav_1, null);
					}
				}

				for (; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].d(1);
				}

				each_blocks_1.length = each_value_1.length;
			}

			if (dirty & /*social*/ 2) {
				each_value = /*social*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$1(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$1(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div0, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let { favicon } = $$props;
	let { image } = $$props;
	let { title } = $$props;
	let { description } = $$props;
	let { nav } = $$props;
	let { social } = $$props;

	$$self.$$set = $$props => {
		if ('favicon' in $$props) $$invalidate(2, favicon = $$props.favicon);
		if ('image' in $$props) $$invalidate(3, image = $$props.image);
		if ('title' in $$props) $$invalidate(4, title = $$props.title);
		if ('description' in $$props) $$invalidate(5, description = $$props.description);
		if ('nav' in $$props) $$invalidate(0, nav = $$props.nav);
		if ('social' in $$props) $$invalidate(1, social = $$props.social);
	};

	return [nav, social, favicon, image, title, description];
}

class Component$4 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$3, create_fragment$4, safe_not_equal, {
			favicon: 2,
			image: 3,
			title: 4,
			description: 5,
			nav: 0,
			social: 1
		});
	}
}

/* generated by Svelte v3.58.0 */

function instance$4($$self, $$props, $$invalidate) {
	let { favicon } = $$props;
	let { image } = $$props;
	let { title } = $$props;
	let { description } = $$props;

	$$self.$$set = $$props => {
		if ('favicon' in $$props) $$invalidate(0, favicon = $$props.favicon);
		if ('image' in $$props) $$invalidate(1, image = $$props.image);
		if ('title' in $$props) $$invalidate(2, title = $$props.title);
		if ('description' in $$props) $$invalidate(3, description = $$props.description);
	};

	return [favicon, image, title, description];
}

class Component$5 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$4, null, safe_not_equal, {
			favicon: 0,
			image: 1,
			title: 2,
			description: 3
		});
	}
}

/* generated by Svelte v3.58.0 */

function create_fragment$5(ctx) {
	let component_0;
	let t0;
	let component_1;
	let t1;
	let component_2;
	let t2;
	let component_3;
	let t3;
	let component_4;
	let current;

	component_0 = new Component({
			props: {
				favicon: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"size": 11
				},
				image: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"size": 52
				},
				title: "gOal",
				description: "timeward"
			}
		});

	component_1 = new Component$2({
			props: {
				favicon: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"size": 11
				},
				image: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"size": 52
				},
				title: "gOal",
				description: "timeward",
				logo: {
					"image": {
						"alt": "",
						"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
						"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
						"size": 11
					},
					"title": "stOneskull.info"
				},
				site_nav: [
					{
						"link": { "url": "/goal", "label": "gOal" }
					},
					{
						"link": {
							"url": "https://stOneskull.xyz",
							"label": "stOneskull"
						}
					}
				]
			}
		});

	component_2 = new Component$3({
			props: {
				favicon: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"size": 11
				},
				image: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"size": 52
				},
				title: "gOal",
				description: "timeward",
				content: {
					"html": "<p>A place to access data, to use for data science.</p><p>One of these days..</p>",
					"markdown": "A place to access data, to use for data science.\n\nOne of these days..\n\n"
				}
			}
		});

	component_3 = new Component$4({
			props: {
				favicon: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"size": 11
				},
				image: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"size": 52
				},
				title: "gOal",
				description: "timeward",
				nav: [
					{
						"link": {
							"url": "https://stOneskull.xyz",
							"label": "(c) 2024 stOneskull"
						}
					}
				],
				social: []
			}
		});

	component_4 = new Component$5({
			props: {
				favicon: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689719427287OIP%20(1).jpeg",
					"size": 11
				},
				image: {
					"alt": "",
					"src": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"url": "https://ogfrjxqovwgsdzubizan.supabase.co/storage/v1/object/public/images/024ce8b7-c530-464d-b25f-cc94b8481f03/1689587573858495276_timothy-leary_1.jpeg",
					"size": 52
				},
				title: "gOal",
				description: "timeward"
			}
		});

	return {
		c() {
			create_component(component_0.$$.fragment);
			t0 = space();
			create_component(component_1.$$.fragment);
			t1 = space();
			create_component(component_2.$$.fragment);
			t2 = space();
			create_component(component_3.$$.fragment);
			t3 = space();
			create_component(component_4.$$.fragment);
		},
		l(nodes) {
			claim_component(component_0.$$.fragment, nodes);
			t0 = claim_space(nodes);
			claim_component(component_1.$$.fragment, nodes);
			t1 = claim_space(nodes);
			claim_component(component_2.$$.fragment, nodes);
			t2 = claim_space(nodes);
			claim_component(component_3.$$.fragment, nodes);
			t3 = claim_space(nodes);
			claim_component(component_4.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(component_0, target, anchor);
			insert_hydration(target, t0, anchor);
			mount_component(component_1, target, anchor);
			insert_hydration(target, t1, anchor);
			mount_component(component_2, target, anchor);
			insert_hydration(target, t2, anchor);
			mount_component(component_3, target, anchor);
			insert_hydration(target, t3, anchor);
			mount_component(component_4, target, anchor);
			current = true;
		},
		p: noop,
		i(local) {
			if (current) return;
			transition_in(component_0.$$.fragment, local);
			transition_in(component_1.$$.fragment, local);
			transition_in(component_2.$$.fragment, local);
			transition_in(component_3.$$.fragment, local);
			transition_in(component_4.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(component_0.$$.fragment, local);
			transition_out(component_1.$$.fragment, local);
			transition_out(component_2.$$.fragment, local);
			transition_out(component_3.$$.fragment, local);
			transition_out(component_4.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(component_0, detaching);
			if (detaching) detach(t0);
			destroy_component(component_1, detaching);
			if (detaching) detach(t1);
			destroy_component(component_2, detaching);
			if (detaching) detach(t2);
			destroy_component(component_3, detaching);
			if (detaching) detach(t3);
			destroy_component(component_4, detaching);
		}
	};
}

class Component$6 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment$5, safe_not_equal, {});
	}
}

export default Component$6;
