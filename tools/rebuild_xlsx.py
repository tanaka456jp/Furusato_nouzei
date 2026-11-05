"""Reconstruct a disposable baseline copy without inheriting OOXML container metadata.

DIAGNOSTIC ONLY. Not approved for replacing the frozen baseline or tax workbooks.
No customer values are used. No existing workbook is overwritten.
"""
from copy import copy, deepcopy
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import MergedCell


def reconstruct(source: Path, output: Path, *, styles: bool, layout: bool) -> None:
    original = load_workbook(source)
    fresh = Workbook()
    fresh.remove(fresh.active)
    try:
        for sheet in original:
            dest = fresh.create_sheet(sheet.title)
            for row in sheet:
                for cell in row:
                    if isinstance(cell, MergedCell):
                        continue
                    target = dest[cell.coordinate]
                    if cell.value is not None:
                        target.value = cell.value
                    if styles and cell.has_style:
                        target.font = copy(cell.font)
                        target.fill = copy(cell.fill)
                        target.border = copy(cell.border)
                        target.alignment = copy(cell.alignment)
                        target.number_format = cell.number_format
                        target.protection = copy(cell.protection)
                    if styles and cell.hyperlink is not None:
                        target.hyperlink = copy(cell.hyperlink)
                    if styles and cell.comment is not None:
                        target.comment = copy(cell.comment)
            if layout:
                for key, dimension in sheet.column_dimensions.items():
                    dest_dim = dest.column_dimensions[key]
                    for prop in ('width', 'hidden', 'outlineLevel', 'collapsed', 'min', 'max'):
                        setattr(dest_dim, prop, getattr(dimension, prop))
                for key, dimension in sheet.row_dimensions.items():
                    dest_dim = dest.row_dimensions[key]
                    for prop in ('height', 'hidden', 'outlineLevel', 'collapsed'):
                        setattr(dest_dim, prop, getattr(dimension, prop))
                for cell_range in sheet.merged_cells.ranges:
                    dest.merge_cells(str(cell_range))
                dest.freeze_panes = sheet.freeze_panes
                dest.data_validations = deepcopy(sheet.data_validations)
                dest.conditional_formatting = deepcopy(sheet.conditional_formatting)
                dest.views = copy(sheet.views)
                dest.sheet_properties = copy(sheet.sheet_properties)
                dest.sheet_format = copy(sheet.sheet_format)
                dest.page_setup = copy(sheet.page_setup)
                dest.page_margins = copy(sheet.page_margins)
                dest.print_options = copy(sheet.print_options)
                if sheet.print_area:
                    dest.print_area = sheet.print_area
        fresh.active = 0
        output.parent.mkdir(parents=True, exist_ok=True)
        fresh.save(output)
    finally:
        fresh.close()
        original.close()
