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
 *                        a COMBINED mutator — a STATEMENT stack of rows (DIN
 *                        rails, "module" blocks) AND a VALUE stack of points,
 *                        because a board can only carry one mutator yet needs
 *                        both rails and (e.g. temperature) points.
 *
 * Serialization: points → extraState { itemCount:N }; board →
 * extraState { rows:N, points:M } (tolerates the legacy { itemCount:N }).
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

  /* ══════════════════════════════════════════════════════════════════════════
   *  dhc_board_mutator  (COMBINED: rows = DIN rails + points = brick:hasPoint)
   *  A board needs both rails (statement, "module") and points (value,
   *  "brick:Point"), but Blockly allows one mutator per block — so this one
   *  manages two stacks. The popup container exposes a ROWS and a POINTS stack.
   * ══════════════════════════════════════════════════════════════════════════ */
  Blockly.Blocks['dhc_board_container'] = {
    init() {
      this.appendDummyInput().appendField('distribution board');
      this.appendDummyInput().appendField('rails (DIN)');
      this.appendStatementInput('ROWS');
      this.appendDummyInput().appendField('points');
      this.appendStatementInput('POINTS');
      this.setColour('#3b82f6');
      this.contextMenu = false;
    },
  };
  Blockly.Blocks['dhc_board_item'] = {
    init() {
      this.appendDummyInput().appendField('DIN rail');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour('#3b82f6');
      this.contextMenu = false;
    },
  };

  const DHC_BOARD_MIXIN = {
    rows_: 2,
    points_: 0,

    saveExtraState() { return { rows: this.rows_, points: this.points_ }; },
    loadExtraState(state) {
      const rows = state.rows ?? state.itemCount ?? 2;   // tolerate legacy {itemCount}
      this.updateShape_(rows, state.points ?? 0);
    },

    decompose(ws) {
      const cb = ws.newBlock('dhc_board_container');
      cb.initSvg();
      let r = cb.getInput('ROWS').connection;
      for (let i = 0; i < this.rows_; i++) {
        const ib = ws.newBlock('dhc_board_item');
        ib.initSvg();
        r.connect(ib.previousConnection);
        r = ib.nextConnection;
      }
      let p = cb.getInput('POINTS').connection;
      for (let i = 0; i < this.points_; i++) {
        const ib = ws.newBlock('dhc_points_item');
        ib.initSvg();
        p.connect(ib.previousConnection);
        p = ib.nextConnection;
      }
      return cb;
    },

    compose(cb) {
      const gather = (name) => {
        let ib = cb.getInputTargetBlock(name);
        const out = [];
        while (ib && !ib.isInsertionMarker()) { out.push(ib.valueConnection_); ib = ib.getNextBlock(); }
        return out;
      };
      const rc = gather('ROWS');
      const pc = gather('POINTS');
      for (let i = 0; i < this.rows_; i++) {
        const t = this.getInput('row_' + i)?.connection.targetConnection;
        if (t && !rc.includes(t)) t.disconnect();
      }
      for (let i = 0; i < this.points_; i++) {
        const inp = this.getInput('point_' + i);
        const t = inp && inp.connection.targetConnection;
        if (t && !pc.includes(t)) t.disconnect();
      }
      this.updateShape_(rc.length, pc.length);
      for (let i = 0; i < rc.length; i++) if (rc[i]) this.getInput('row_' + i)?.connection.connect(rc[i]);
      for (let i = 0; i < pc.length; i++) if (pc[i]) this.getInput('point_' + i)?.connection.connect(pc[i]);
    },

    saveConnections(cb) {
      const save = (name, prefix) => {
        let ib = cb.getInputTargetBlock(name);
        let i = 0;
        while (ib) {
          const inp = this.getInput(prefix + i);
          ib.valueConnection_ = inp ? inp.connection.targetConnection : null;
          i++;
          ib = ib.getNextBlock();
        }
      };
      save('ROWS', 'row_');
      save('POINTS', 'point_');
    },

    updateShape_(rows, points) {
      let i = 0;
      while (this.getInput('row_' + i)) { this.removeInput('row_' + i); i++; }
      i = 0;
      while (this.getInput('point_' + i)) { this.removeInput('point_' + i); i++; }
      for (i = 0; i < rows; i++) {
        this.appendStatementInput('row_' + i).setCheck('module').appendField('rail ' + (i + 1));
      }
      for (i = 0; i < points; i++) {
        this.appendValueInput('point_' + i).setCheck('brick:Point').appendField('point ' + (i + 1));
      }
      this.rows_ = rows;
      this.points_ = points;
    },
  };

  function DHC_BOARD_HELPER() { this.updateShape_(this.rows_, this.points_); }

  Blockly.Extensions.registerMutator(
    'dhc_board_mutator',
    DHC_BOARD_MIXIN,
    DHC_BOARD_HELPER,
    ['dhc_board_container', 'dhc_board_item', 'dhc_points_item']
  );

  console.info('[dhc/registerPlugins-electrical] mutators registered: dhc_points_mutator (brick:hasPoint), dhc_board_mutator (rails + points)');
})();
