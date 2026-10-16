import React, { useState } from 'react';
import { Link2, Trash2, Plus, FlaskConical, Search, Check } from 'lucide-react';

interface SyrupGroupsConfigProps {
  compatibleSyrupGroups?: Record<string, string[]>;
  availableProducts: string[];
  onChange: (updatedGroups: Record<string, string[]>) => void;
}

export const SyrupGroupsConfig: React.FC<SyrupGroupsConfigProps> = ({
  compatibleSyrupGroups = {},
  availableProducts,
  onChange,
}) => {
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [searchFilter, setSearchFilter] = useState('');

  const filteredProducts = availableProducts.filter(p =>
    p.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const handleToggleProduct = (product: string) => {
    if (selectedProducts.includes(product)) {
      setSelectedProducts(selectedProducts.filter(p => p !== product));
    } else {
      setSelectedProducts([...selectedProducts, product]);
    }
  };

  const handleAddGroup = () => {
    if (selectedProducts.length < 2) return;
    const groupName = newGroupName.trim() || selectedProducts.join(' / ');
    const updated = { ...compatibleSyrupGroups, [groupName]: [...selectedProducts] };
    onChange(updated);
    setNewGroupName('');
    setSelectedProducts([]);
  };

  const handleDeleteGroup = (groupKey: string) => {
    const updated = { ...compatibleSyrupGroups };
    delete updated[groupKey];
    onChange(updated);
  };

  return (
    <section className="bg-amber-50/70 p-5 rounded-xl border border-amber-200 lg:col-span-2 space-y-4">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div>
          <h4 className="text-base font-bold text-amber-900 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-amber-700" />
            Grupos de Jarabes Equivalentes / Compartidos
          </h4>
          <p className="text-xs text-amber-800 mt-1 max-w-3xl leading-relaxed">
            Agrupe combinaciones de <strong>Marca y Sabor</strong> que comparten el mismo jarabe base en jarabería 
            (ej. <em>Torasso - Cola</em> y <em>Fernando - Cola</em> usan el mismo lote de jarabe en tanque).
            En el <strong>Balance de Jarabes</strong>, la producción y elaboración se consolidarán bajo este grupo 
            para reflejar el consumo físico real y evitar desfasajes de inventario.
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Grupos Configurados */}
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold text-amber-900 uppercase tracking-wider">Grupos Configurados</h5>
            <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              {Object.keys(compatibleSyrupGroups).length} grupos
            </span>
          </div>

          <div className="space-y-2.5">
            {Object.entries(compatibleSyrupGroups).map(([groupKey, members]) => {
              const memberList = Array.isArray(members) ? (members as string[]) : [];
              return (
                <div 
                  key={groupKey} 
                  className="flex items-center justify-between bg-white px-4 py-3 border border-amber-200 rounded-xl shadow-sm hover:border-amber-300 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="text-sm font-bold text-gray-800 truncate">{groupKey}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {memberList.map((item, i) => (
                        <span 
                          key={item} 
                          className="inline-flex items-center text-xs font-medium text-amber-900 bg-amber-100/90 px-2 py-0.5 rounded border border-amber-200/80"
                        >
                          {item}
                          {i < memberList.length - 1 && <span className="mx-1 text-amber-400">/</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteGroup(groupKey)}
                    className="text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                    title="Eliminar grupo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}

            {Object.keys(compatibleSyrupGroups).length === 0 && (
              <div className="text-xs text-amber-800/80 italic bg-white/70 px-4 py-6 rounded-xl border border-amber-200 text-center">
                No hay grupos configurados todavía. Cada combinación de marca y sabor se computará de forma independiente.
              </div>
            )}
          </div>
        </div>

        {/* Crear Nuevo Grupo */}
        <div className="w-full lg:max-w-md bg-white p-5 rounded-xl border border-amber-200 shadow-sm space-y-4">
          <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-amber-600" />
            Crear Grupo de Jarabe Compartido
          </h5>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Nombre del Grupo / Jarabe Base:
            </label>
            <input
              type="text"
              placeholder="Ej: Jarabe Cola (o dejar vacío para autodenominar)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-gray-700">
                Seleccionar Marca - Sabor:
              </label>
              {selectedProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedProducts([])}
                  className="text-[11px] text-amber-700 hover:underline"
                >
                  Limpiar ({selectedProducts.length})
                </button>
              )}
            </div>

            {availableProducts.length > 6 && (
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-gray-200 rounded-lg focus:border-amber-400 outline-none"
                />
              </div>
            )}

            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50/80 space-y-1">
              {filteredProducts.map(prod => {
                const isSelected = selectedProducts.includes(prod);
                return (
                  <label
                    key={prod}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? 'bg-amber-100 text-amber-900 font-semibold border border-amber-200'
                        : 'hover:bg-white text-gray-700 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="rounded text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                      checked={isSelected}
                      onChange={() => handleToggleProduct(prod)}
                    />
                    <span className="truncate">{prod}</span>
                  </label>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="text-center py-4 text-xs text-gray-400">
                  No se encontraron productos
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddGroup}
            disabled={selectedProducts.length < 2}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm transition-colors uppercase tracking-wider"
          >
            <Check className="w-4 h-4" />
            Guardar Grupo ({selectedProducts.length} seleccionados)
          </button>
        </div>
      </div>
    </section>
  );
};
