/* DHC Blockly plugin registry — electrical harness
 *
 * Self-contained so the electrical designer does not depend on the spatial
 * harness's registerPlugins.js. Load AFTER Blockly, BEFORE
 * Blockly.defineBlocksWithJsonArray runs against electrical-blocks.json.
 *
 * Registered mutators
 * ───────────────────
 *   dhc_board_mutator  → dhc:DistributionBoard, dhc:SubDistributionBoard
 *                        variable-arity STATEMENT slots = the board's rows
 *                        (DIN rails). Each row slot accepts "module" blocks
 *                        (breakers / RCDs / circuits — the follow-up toolbox).
 *
 * Serialization shape: extraState: { itemCount: N } — matches the text_join
 * convention, so a workspace round-trip looks like the built-in dynamic blocks.
 */

(function () {
  if (typeof Blockly === 'undefined') {
    console.error('[dhc/registerPlugins-electrical] Blockly must load before this script');
    return;
  }

  /* ── Generic variable-arity STATEMENT mutator ─────────────────────────────
   * Slots use appendStatementInput; children connect via previous/next.
   *   perItemLabel — label EVERY slot with a 1-based index ("rail 1", "rail 2")
   *   firstLabel   — label only the first slot (fallback when no perItemLabel)
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
        while (ib && !ib.isInsertionMarker()) {
          conns.push(ib.valueConnection_);
          ib = ib.getNextBlock();
        }
        for (let i = 0; i < this.itemCount_; i++) {
          const c = this.getInput(cfg.inputPrefix + i)?.connection.targetConnection;
          if (c && !conns.includes(c)) c.disconnect();
        }
        this.itemCount_ = conns.length;
        this.updateShape_(this.itemCount_);
        for (let i = 0; i < this.itemCount_; i++) {
          if (conns[i]) {
            const slot = this.getInput(cfg.inputPrefix + i);
            if (slot) slot.connection.connect(conns[i]);
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
          const slot = this.appendStatementInput(cfg.inputPrefix + i).setCheck(cfg.inputCheck);
          if (cfg.perItemLabel) slot.appendField(cfg.perItemLabel + ' ' + (i + 1));
          else if (i === 0) slot.appendField(cfg.firstLabel);
        }
        this.itemCount_ = count;
      },
    };
  }

  /* ── Helper blocks for the gear-icon popup ────────────────────────────────── */
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

  /* ══════════════════════════════════════════════════════════════════════════
   *  dhc_board_mutator  (rows = DIN rails; each holds "module" blocks)
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

  console.info('[dhc/registerPlugins-electrical] mutators registered: dhc_board_mutator (rows = DIN rails)');
})();
