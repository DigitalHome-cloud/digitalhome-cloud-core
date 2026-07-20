/* DHC Blockly plugin registry — electrical harness
 *
 * Self-contained so the electrical designer does not depend on the spatial
 * harness's registerPlugins.js. Load AFTER Blockly, BEFORE
 * Blockly.defineBlocksWithJsonArray runs against electrical-blocks.json.
 *
 * Registered mutators
 * ───────────────────
 *   dhc_points_mutator → any smart device: variable-arity VALUE slots =
 *                        automation points (brick:hasPoint). Child dhcb:Point
 *                        blocks declare output "brick:Point".
 *   dhc_board_mutator  → dhc:DistributionBoard, dhc:SubDistributionBoard:
 *                        variable-arity STATEMENT slots = the board's rows (DIN
 *                        rails). A board is rows-only — automation on a board is
 *                        a dhcb:IoTDevice DIN module dropped onto a rail, which
 *                        carries its own points (dhc_points_mutator).
 *
 * Serialization: extraState { itemCount:N } — matches the text_join convention.
 */

(function () {
  if (typeof Blockly === 'undefined') {
    console.error('[dhc/registerPlugins-electrical] Blockly must load before this script');
    return;
  }

  /* ── Helper blocks for a gear-icon popup stack ─────────────────────────── */
  function registerHelperBlocks(containerType, containerLabel, itemType, itemLabel, colour) {
    Blockly.Blocks[containerType] = {
      init() {
        this.appendDummyInput().appendField(containerLabel);
        this.appendStatementInput('STACK');
        this.setColour(colour);
        this.contextMenu = false;
      },
    };
    Blockly.Blocks[itemType] = {
      init() {
        this.appendDummyInput().appendField(itemLabel);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(colour);
        this.contextMenu = false;
      },
    };
  }

  /* ── Generic variable-arity VALUE mutator ─────────────────────────────────
   * Slots use appendValueInput; children connect via an output plug. Used for
   * brick:hasPoint — a smart device carries N automation points, each a
   * dhcb:Point block declaring output "brick:Point".
   */
  function makeValueMutatorMixin(cfg) {
    return {
      itemCount_: cfg.defaultCount || 0,

      saveExtraState() { return { itemCount: this.itemCount_ }; },
      loadExtraState(state) { this.updateShape_(state.itemCount || cfg.defaultCount || 0); },

      decompose(ws) {
        const cb = ws.newBlock(cfg.containerType);
        cb.initSvg();
        let conn = cb.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const ib = ws.newBlock(cfg.itemType);
          ib.initSvg();
          conn.connect(ib.previousConnection);
          conn = ib.nextConnection;
        }
        return cb;
      },

      compose(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        const conns = [];
        while (ib && !ib.isInsertionMarker()) {
          conns.push(ib.valueConnection_);
          ib = ib.getNextBlock();
        }
        for (let i = 0; i < this.itemCount_; i++) {
          const inp = this.getInput(cfg.inputPrefix + i);
          const tc = inp && inp.connection.targetConnection;
          if (tc && !conns.includes(tc)) tc.disconnect();
        }
        this.itemCount_ = conns.length;
        this.updateShape_(this.itemCount_);
        for (let i = 0; i < this.itemCount_; i++) {
          if (conns[i]) {
            const inp = this.getInput(cfg.inputPrefix + i);
            if (inp) inp.connection.connect(conns[i]);
          }
        }
      },

      saveConnections(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (ib) {
          const inp = this.getInput(cfg.inputPrefix + i);
          ib.valueConnection_ = inp ? inp.connection.targetConnection : null;
          i++;
          ib = ib.getNextBlock();
        }
      },

      updateShape_(count) {
        let i = 0;
        while (this.getInput(cfg.inputPrefix + i)) {
          this.removeInput(cfg.inputPrefix + i);
          i++;
        }
        for (i = 0; i < count; i++) {
          this.appendValueInput(cfg.inputPrefix + i).setCheck(cfg.inputCheck)
            .appendField((cfg.perItemLabel || 'item') + ' ' + (i + 1));
        }
        this.itemCount_ = count;
      },
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  dhc_points_mutator  (brick:hasPoint — N automation points on a device)
   * ══════════════════════════════════════════════════════════════════════════ */
  registerHelperBlocks(
    'dhc_points_container', 'smart device',
    'dhc_points_item',      'point',
    '#a855f7'
  );

  const DHC_POINTS_MIXIN = makeValueMutatorMixin({
    containerType: 'dhc_points_container',
    itemType:      'dhc_points_item',
    inputPrefix:   'point_',
    inputCheck:    'brick:Point',
    perItemLabel:  'point',
    defaultCount:  0,
  });

  function DHC_POINTS_HELPER() { this.updateShape_(this.itemCount_); }

  Blockly.Extensions.registerMutator(
    'dhc_points_mutator',
    DHC_POINTS_MIXIN,
    DHC_POINTS_HELPER,
    ['dhc_points_container', 'dhc_points_item']
  );

  /* ── Generic variable-arity STATEMENT mutator ─────────────────────────────
   * Slots use appendStatementInput; children connect via previous/next.
   */
  function makeMutatorMixin(cfg) {
    return {
      itemCount_: cfg.defaultCount || 1,

      saveExtraState() { return { itemCount: this.itemCount_ }; },
      loadExtraState(state) { this.updateShape_(state.itemCount || cfg.defaultCount || 1); },

      decompose(ws) {
        const cb = ws.newBlock(cfg.containerType);
        cb.initSvg();
        let conn = cb.getInput('STACK').connection;
        for (let i = 0; i < this.itemCount_; i++) {
          const ib = ws.newBlock(cfg.itemType);
          ib.initSvg();
          conn.connect(ib.previousConnection);
          conn = ib.nextConnection;
        }
        return cb;
      },

      compose(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        const conns = [];
        while (ib && !ib.isInsertionMarker()) { conns.push(ib.valueConnection_); ib = ib.getNextBlock(); }
        for (let i = 0; i < this.itemCount_; i++) {
          const c = this.getInput(cfg.inputPrefix + i)?.connection.targetConnection;
          if (c && !conns.includes(c)) c.disconnect();
        }
        this.itemCount_ = conns.length;
        this.updateShape_(this.itemCount_);
        for (let i = 0; i < this.itemCount_; i++) {
          if (conns[i]) { const slot = this.getInput(cfg.inputPrefix + i); if (slot) slot.connection.connect(conns[i]); }
        }
      },

      saveConnections(containerBlock) {
        let ib = containerBlock.getInputTargetBlock('STACK');
        let i = 0;
        while (ib) { const inp = this.getInput(cfg.inputPrefix + i); ib.valueConnection_ = inp ? inp.connection.targetConnection : null; i++; ib = ib.getNextBlock(); }
      },

      updateShape_(count) {
        let i = 0;
        while (this.getInput(cfg.inputPrefix + i)) { this.removeInput(cfg.inputPrefix + i); i++; }
        for (i = 0; i < count; i++) {
          const slot = this.appendStatementInput(cfg.inputPrefix + i).setCheck(cfg.inputCheck);
          if (cfg.perItemLabel) slot.appendField(cfg.perItemLabel + ' ' + (i + 1));
          else if (i === 0) slot.appendField(cfg.firstLabel);
        }
        this.itemCount_ = count;
      },
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  dhc_board_mutator  (rows = DIN rails; rows-only — a board is not a point
   *  host. Automation on a board is a dhcb:IoTDevice DIN module on a rail.)
   * ══════════════════════════════════════════════════════════════════════════ */
  registerHelperBlocks(
    'dhc_board_container', 'distribution board',
    'dhc_board_item',      'DIN rail',
    '#3b82f6'
  );

  const DHC_BOARD_MIXIN = makeMutatorMixin({
    containerType: 'dhc_board_container',
    itemType:      'dhc_board_item',
    inputPrefix:   'row_',
    inputCheck:    'module',
    perItemLabel:  'rail',
    defaultCount:  2,
  });

  function DHC_BOARD_HELPER() { this.updateShape_(this.itemCount_); }

  Blockly.Extensions.registerMutator(
    'dhc_board_mutator',
    DHC_BOARD_MIXIN,
    DHC_BOARD_HELPER,
    ['dhc_board_container', 'dhc_board_item']
  );

  console.info('[dhc/registerPlugins-electrical] mutators registered: dhc_points_mutator (brick:hasPoint), dhc_board_mutator (rows = DIN rails)');
})();
