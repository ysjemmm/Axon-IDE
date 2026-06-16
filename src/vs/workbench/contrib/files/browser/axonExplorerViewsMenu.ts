/*---------------------------------------------------------------------------------------------
 *  Axon —— 资源管理器「视图显隐」工具栏按钮
 *
 *  背景：Axon 隐藏了主侧栏顶部的 viewlet 标题栏（EXPLORER 那一行），其中的「…」更多按钮
 *  原本承载着切换左侧各模块（Open Editors / Folders / Outline / Timeline / Skills /
 *  NPM Scripts 等）显隐的菜单。本文件在资源管理器文件视图（workbench.explorer.fileView）
 *  的标题工具栏最右侧补回一个同风格的「更多」按钮，点击后弹出一个带图标的视图显隐选择器。
 *
 *  实现说明：VS Code 原生下拉/上下文菜单无法在同一行同时渲染「图标 + 文字」（icon 模式会把
 *  codicon 字体加到文字标签上导致文字乱码），因此这里改用 QuickPick——其标签支持内联
 *  `$(codicon)` 渲染，可同时显示「图标 + 视图名」，并以多选勾选框表达显隐状态。
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IViewDescriptor, IViewDescriptorService } from '../../../common/views.js';
import { VIEW_ID, VIEWLET_ID } from '../common/files.js';

const TOGGLE_VIEWS_MENU_COMMAND_ID = 'axon.explorer.toggleViewsVisibilityMenu';

/** 携带视图 id 的 QuickPick 选项 */
interface ViewPickItem extends IQuickPickItem {
	viewId: string;
}

class ToggleExplorerViewsVisibilityAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_VIEWS_MENU_COMMAND_ID,
			title: localize2('axon.explorer.viewsMenu', "显示或隐藏视图"),
			icon: Codicon.ellipsis,
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', VIEW_ID),
				group: 'navigation',
				// 放在最后，处于刷新 / 折叠等按钮右侧
				order: 1000,
			}],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const viewDescriptorService = accessor.get(IViewDescriptorService);

		const container = viewDescriptorService.getViewContainerById(VIEWLET_ID);
		if (!container) {
			return;
		}
		const model = viewDescriptorService.getViewContainerModel(container);
		const views = model.activeViewDescriptors.filter(v => v.canToggleVisibility);
		if (views.length === 0) {
			return;
		}

		const items: ViewPickItem[] = views.map(v => ({
			viewId: v.id,
			label: toIconLabel(v),
			picked: model.isVisible(v.id),
		}));

		const picked = await quickInputService.pick(items, {
			canPickMany: true,
			title: localize('axon.explorer.viewsMenu.title', "显示或隐藏视图"),
			placeHolder: localize('axon.explorer.viewsMenu.placeholder', "勾选要在资源管理器中显示的视图"),
		});
		if (!picked) {
			return; // 用户取消
		}

		await this.applyVisibility(views, picked, model, commandService);
	}

	/** 将勾选结果应用为各视图的显隐（仅对发生变化的视图执行切换命令）。 */
	private async applyVisibility(
		views: readonly IViewDescriptor[],
		picked: ViewPickItem[],
		model: { isVisible(id: string): boolean },
		commandService: ICommandService,
	): Promise<void> {
		const pickedIds = new Set(picked.map(p => p.viewId));
		for (const v of views) {
			const shouldShow = pickedIds.has(v.id);
			if (shouldShow !== model.isVisible(v.id)) {
				// 复用官方按视图注册的切换命令，显隐逻辑与原「…」菜单完全一致
				await commandService.executeCommand(`${v.id}.toggleVisibility`);
			}
		}
	}
}

/** 构造「$(图标) 视图名」标签：QuickPick 会把 `$(codicon)` 内联渲染为图标。 */
function toIconLabel(view: IViewDescriptor): string {
	const icon = view.containerIcon;
	const name = view.name.value;
	if (icon && ThemeIcon.isThemeIcon(icon)) {
		return `$(${icon.id}) ${name}`;
	}
	return name;
}

registerAction2(ToggleExplorerViewsVisibilityAction);
