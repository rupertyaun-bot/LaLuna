import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPE DEFINITIONS ---
type User = {
    id: string;
    name: string;
    pin: string;
    role: 'Admin' | 'Employee';
    dailyRate?: number;
};

type StockHistoryItem = {
  date: string;
  quantity: number;
  unitCost: number; // Cost per unit for this specific batch
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  price: number; // Selling price per unit, if sellable
  lowStockThreshold: number;
  stockHistory: StockHistoryItem[];
};

type RecipeItem = {
  ingredientId: string;
  quantity: number;
};

type Product = {
  id:string;
  name: string;
  price: number;
  quantity: number; // For MISC_COST, for PRODUCT this is calculated
  cost: number;     // For MISC_COST, for PRODUCT this is calculated
  type: 'PRODUCT' | 'MISC_COST';
  recipe: RecipeItem[];
  timestamp?: string; // For time-sensitive costs like labor
};

type Tax = {
    id: string;
    name: string;
    rate: number;
};

type StockCountItem = {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  expectedStock: number;
  actualStock: number | '';
  unitCost: number;
};

type StockCount = {
  id: string;
  timestamp: string;
  items: StockCountItem[];
  totalVarianceValue: number;
};

type TimeClockEntry = {
    id: string;
    userId: string;
    startTime: string;
    endTime?: string;
};


type ProductFormData = Omit<Product, 'price' | 'quantity' | 'cost'> & {
    price: number | '';
    quantity: number | '';
    cost: number | '';
};

type IngredientFormData = Omit<Ingredient, 'stockHistory'> & {
    stock: number | '';
    totalCost: number | '';
}

type CartItem = {
  itemId: string;
  name:string;
  price: number;
  quantity: number;
  type: 'PRODUCT' | 'INGREDIENT';
};

type Transaction = {
  id: string;
  items: CartItem[];
  total: number;
  timestamp: string;
  paymentMode?: 'Cash' | 'E-Payment' | 'Internal';
  notes?: string;
  isEmployeeMeal?: boolean;
};

type KitchenOrder = {
  id: string;
  orderNumber: number;
  timestamp: string;
  items: CartItem[];
};

type LastOrderNumber = {
  date: string; // YYYY-MM-DD
  number: number;
};

type AdminView = 'DASHBOARD' | 'POS' | 'INVENTORY' | 'SETTINGS';
type InventoryTab = 'PRODUCTS' | 'INGREDIENTS' | 'MISC' | 'STOCK_COUNT' | 'STOCK_HISTORY';


// --- MOCK INITIAL DATA ---
const getInitialData = () => {
    return {
      inventory: [],
      transactions: [],
      ingredients: []
    }
}

// --- HELPER HOOKS & FUNCTIONS ---
const getIngredientTotalStock = (ingredient: Ingredient): number => {
  return ingredient.stockHistory.reduce((sum, record) => sum + record.quantity, 0);
};

const getIngredientAverageCost = (ingredient: Ingredient): number => {
  const totalStock = getIngredientTotalStock(ingredient);
  if (totalStock <= 0) return 0;
  const totalCost = ingredient.stockHistory.reduce((sum, record) => sum + (record.quantity * record.unitCost), 0);
  return totalCost / totalStock;
};


const useLocalStorage = <T,>(key: string, initialValue: T) => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (!item) return initialValue;
      let parsed = JSON.parse(item);

      // Migration for inventory to add properties
      if (key === 'pos-inventory' && Array.isArray(parsed)) {
          parsed = parsed.map((p: any) => ({
              ...p,
              type: p.type || 'PRODUCT',
              recipe: p.recipe || []
            }));
      }
      // Migration for ingredients to add price and unitCost
       if (key === 'pos-ingredients' && Array.isArray(parsed)) {
          parsed = parsed.map((i: any) => {
            const migrated = { ...i };
            if (!migrated.price) migrated.price = 0;
            if (!migrated.lowStockThreshold) migrated.lowStockThreshold = 0;

            // New migration for stock history
            if (!migrated.stockHistory && migrated.hasOwnProperty('stock')) {
              const unitCost = migrated.unitCost ?? (migrated.hasOwnProperty('cost') && migrated.stock > 0 ? migrated.cost / migrated.stock : 0);
              migrated.stockHistory = [{
                date: new Date().toISOString(),
                quantity: migrated.stock,
                unitCost: unitCost
              }];
              delete migrated.stock; // remove old properties
              delete migrated.unitCost;
              delete migrated.cost;
            } else if (!migrated.stockHistory) {
              migrated.stockHistory = [];
            }
            return migrated;
          });
      }
      // Migration for time clock entries to add userId
      if (key === 'pos-time-clock' && Array.isArray(parsed)) {
          parsed = parsed.map((t: any) => ({
            ...t,
            userId: t.userId || 'legacy_user'
          }));
      }
      // Migration for users to change hourlyRate to dailyRate
      if (key === 'pos-users' && Array.isArray(parsed)) {
          parsed = parsed.map((u: any) => {
              const migratedUser = { ...u };
              if (migratedUser.hasOwnProperty('hourlyRate') && !migratedUser.hasOwnProperty('dailyRate')) {
                  // Assuming a standard 8-hour day for migration from old hourly rate
                  migratedUser.dailyRate = (migratedUser.hourlyRate || 0) * 8;
                  delete migratedUser.hourlyRate;
              }
              if (!migratedUser.hasOwnProperty('dailyRate')) {
                  migratedUser.dailyRate = 0;
              }
              return migratedUser;
          });
      }
      return parsed;

    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue] as const;
};

const formatCurrency = (amount: number) => {
  return `Php ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const calculateProductCost = (recipe: RecipeItem[], ingredients: Ingredient[]): number => {
    return recipe.reduce((totalCost, recipeItem) => {
        const ingredient = ingredients.find(i => i.id === recipeItem.ingredientId);
        if (!ingredient) return totalCost;
        return totalCost + (getIngredientAverageCost(ingredient) * recipeItem.quantity);
    }, 0);
};

const calculateProductStock = (recipe: RecipeItem[], ingredients: Ingredient[]): number => {
    if (!recipe || recipe.length === 0) return 0;
    const stockLevels = recipe.map(recipeItem => {
        const ingredient = ingredients.find(i => i.id === recipeItem.ingredientId);
        const ingredientStock = ingredient ? getIngredientTotalStock(ingredient) : 0;
        if (!ingredient || ingredientStock === 0 || recipeItem.quantity === 0) return 0;
        return Math.floor(ingredientStock / recipeItem.quantity);
    });
    return Math.min(...stockLevels);
};

const useTimer = (startTime: string) => {
    const [elapsedTime, setElapsedTime] = useState('00:00');
    useEffect(() => {
        const interval = setInterval(() => {
            const start = new Date(startTime).getTime();
            const now = Date.now();
            const diffSeconds = Math.floor((now - start) / 1000);
            const minutes = String(Math.floor(diffSeconds / 60)).padStart(2, '0');
            const seconds = String(diffSeconds % 60).padStart(2, '0');
            setElapsedTime(`${minutes}:${seconds}`);
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);
    return elapsedTime;
};


// --- UI COMPONENTS ---
const IngredientModal = ({ ingredient, onClose, onSave, ingredients }: { ingredient?: Ingredient, onClose: () => void, onSave: (ing: Ingredient) => void, ingredients: Ingredient[] }) => {
    const [formData, setFormData] = useState(
        ingredient
            ? { ...ingredient, stock: '', totalCost: '', addQuantity: '', addTotalCost: '' }
            : { id: '', name: '', unit: '', price: '', lowStockThreshold: '', stock: '', totalCost: '', addQuantity: '', addTotalCost: '', stockHistory: [] as StockHistoryItem[] }
    );
     const [error, setError] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, [name]: value}));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!formData.name || !formData.unit) {
            setError("Ingredient Name and Unit are required.");
            return;
        }

        const existingIngredient = ingredients.find(i =>
            i.name.toLowerCase() === formData.name.toLowerCase() && i.id !== formData.id
        );
        if (existingIngredient) {
            setError(`An ingredient with the name "${formData.name}" already exists.`);
            return;
        }

        let updatedIngredient: Ingredient;

        if (ingredient) { // Editing existing ingredient
            const addQuantity = parseFloat(String(formData.addQuantity)) || 0;
            const addTotalCost = parseFloat(String(formData.addTotalCost)) || 0;

            updatedIngredient = { ...ingredient, name: formData.name, unit: formData.unit, price: parseFloat(String(formData.price)) || 0, lowStockThreshold: parseInt(String(formData.lowStockThreshold), 10) || 0, stockHistory: [...ingredient.stockHistory]};

            if (addQuantity > 0) {
                 const newUnitCost = addTotalCost > 0 && addQuantity > 0 ? addTotalCost / addQuantity : 0;
                 updatedIngredient.stockHistory.push({
                     date: new Date().toISOString(),
                     quantity: addQuantity,
                     unitCost: newUnitCost
                 });
            }
        } else { // Creating new ingredient
             const stock = parseInt(String(formData.stock), 10) || 0;
             const totalCost = parseFloat(String(formData.totalCost)) || 0;
             if (stock <= 0) {
                setError("Stock quantity must be greater than 0 for a new ingredient.");
                return;
             }
             const unitCost = totalCost / stock;
             updatedIngredient = {
                id: `ing_${Date.now()}`,
                name: formData.name,
                unit: formData.unit,
                price: parseFloat(String(formData.price)) || 0,
                lowStockThreshold: parseInt(String(formData.lowStockThreshold), 10) || 0,
                stockHistory: [{
                    date: new Date().toISOString(),
                    quantity: stock,
                    unitCost: unitCost
                }]
             };
        }
        onSave(updatedIngredient);
    };

    return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>{ingredient ? 'Edit Ingredient' : 'Add New Ingredient'}</h2>
        <form onSubmit={handleSubmit}>
            {error && <p className="form-error">{error}</p>}
            <div className="form-group">
                <label>Ingredient Name</label>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required placeholder="e.g., Burger Patty"/>
            </div>
             <div className="form-group">
                <label>Unit of Measurement</label>
                <input type="text" name="unit" value={formData.unit} onChange={handleChange} required placeholder="e.g., pcs, g, ml"/>
            </div>

            {!ingredient && (
                <>
                    <div className="form-group">
                        <label>Initial Stock Quantity</label>
                        <input type="number" name="stock" value={formData.stock} onChange={handleChange} required placeholder="e.g., 100" min="0" />
                    </div>
                    <div className="form-group">
                        <label>Total Cost for Initial Stock (Php)</label>
                        <input type="number" name="totalCost" value={formData.totalCost} onChange={handleChange} required placeholder="e.g., 500.00" min="0" step="0.01"/>
                    </div>
                </>
            )}

             <div className="form-group">
                <label>Selling Price per Unit (Optional)</label>
                <input type="number" name="price" value={formData.price} onChange={handleChange} placeholder="e.g., 15.00" min="0" step="0.01"/>
                <small>Set a price if this can be sold as an "extra".</small>
            </div>
            <div className="form-group">
                <label>Low Stock Alert Threshold (Optional)</label>
                <input type="number" name="lowStockThreshold" value={formData.lowStockThreshold} onChange={handleChange} placeholder="e.g., 10" min="0" />
                <small>Get a notification when stock falls below this quantity. Set to 0 to disable.</small>
            </div>

            {ingredient && (
                <div className="add-stock-section">
                    <h3>Add New Stock Batch</h3>
                    <div className="form-group">
                        <label>Quantity to Add</label>
                        <input type="number" name="addQuantity" value={formData.addQuantity} onChange={handleChange} placeholder="e.g., 50" min="0" />
                    </div>
                     <div className="form-group">
                        <label>Total Cost for this Batch (Php)</label>
                        <input type="number" name="addTotalCost" value={formData.addTotalCost} onChange={handleChange} placeholder="e.g., 250.00" min="0" step="0.01"/>
                    </div>
                </div>
            )}

            <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Ingredient</button>
            </div>
        </form>
      </div>
    </div>
    )
}

const ProductModal = ({ product, ingredients, onClose, onSave }: { product?: Product, ingredients: Ingredient[], onClose: () => void, onSave: (product: Product) => void }) => {
  const [formData, setFormData] = useState<ProductFormData>(
    product || { id: '', name: '', price: '', quantity: '', cost: '', type: 'PRODUCT', recipe: [] }
  );

  const [recipeBuilder, setRecipeBuilder] = useState({ingId: '', qty: ''});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    setFormData(prev => ({...prev, [name]: value}));
  };

  const handleRecipeBuilderChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const {name, value} = e.target;
      setRecipeBuilder(prev => ({...prev, [name]: value}));
  }

  const handleAddIngredientToRecipe = () => {
    if(!recipeBuilder.ingId || !recipeBuilder.qty || parseFloat(recipeBuilder.qty) <= 0) return;
    const newRecipeItem = { ingredientId: recipeBuilder.ingId, quantity: parseFloat(recipeBuilder.qty)};

    setFormData(prev => {
        const existingItemIndex = prev.recipe.findIndex(item => item.ingredientId === newRecipeItem.ingredientId);
        let newRecipe = [...prev.recipe];
        if(existingItemIndex > -1) {
            newRecipe[existingItemIndex] = newRecipeItem;
        } else {
            newRecipe.push(newRecipeItem);
        }
        return {...prev, recipe: newRecipe};
    })
    setRecipeBuilder({ingId: '', qty: ''});
  }

  const handleRemoveIngredient = (ingredientId: string) => {
      setFormData(prev => ({...prev, recipe: prev.recipe.filter(item => item.ingredientId !== ingredientId)}))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      id: formData.id || `prod_${Date.now()}`,
      price: parseFloat(String(formData.price)) || 0,
      // quantity and cost are now calculated for PRODUCTS, but we need to set them for MISC_COST
      quantity: formData.type === 'MISC_COST' ? 1 : 0,
      cost: formData.type === 'MISC_COST' ? parseFloat(String(formData.cost)) || 0 : 0,
      recipe: formData.type === 'PRODUCT' ? formData.recipe : [],
     });
  };

  const isMiscCost = formData.type === 'MISC_COST';

  const calculatedCost = useMemo(() => calculateProductCost(formData.recipe, ingredients), [formData.recipe, ingredients]);
  const calculatedStock = useMemo(() => calculateProductStock(formData.recipe, ingredients), [formData.recipe, ingredients]);


  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>{product ? 'Edit Item' : 'Add New Item'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Item Type</label>
            <select name="type" value={formData.type} onChange={handleChange}>
                <option value="PRODUCT">Product for Sale</option>
                <option value="MISC_COST">Miscellaneous Cost</option>
            </select>
          </div>
          <div className="form-group">
            <label>Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} required />
          </div>
          {isMiscCost ? (
             <div className="form-group">
                <label>Cost (Php)</label>
                <input type="number" name="cost" value={formData.cost} onChange={handleChange} required placeholder="e.g., 50.25" min="0" step="0.01" />
             </div>
          ) : (
            <>
                <div className="form-group">
                    <label>Price (Php)</label>
                    <input type="number" name="price" value={formData.price} onChange={handleChange} placeholder="e.g., 100.50" required min="0" step="0.01" />
                </div>

                <div className="recipe-builder">
                    <h3>Recipe</h3>
                    <div className="recipe-builder-inputs">
                        <select name="ingId" value={recipeBuilder.ingId} onChange={handleRecipeBuilderChange}>
                            <option value="">Select Ingredient</option>
                            {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}
                        </select>
                        <input type="number" name="qty" placeholder="Qty" value={recipeBuilder.qty} onChange={handleRecipeBuilderChange} min="0" />
                        <button type="button" className="btn btn-secondary" onClick={handleAddIngredientToRecipe}>Add</button>
                    </div>
                    <ul className="recipe-list">
                        {formData.recipe.map(item => {
                            const ingredient = ingredients.find(i => i.id === item.ingredientId);
                            return (
                                <li key={item.ingredientId}>
                                    <span>{ingredient?.name}: {item.quantity} {ingredient?.unit}</span>
                                    <button type="button" onClick={() => handleRemoveIngredient(item.ingredientId)}>&times;</button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="recipe-summary">
                        <p>Calculated Cost: <strong>{formatCurrency(calculatedCost)}</strong></p>
                        <p>Calculated Stock: <strong>{calculatedStock} units</strong></p>
                    </div>
                </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DashboardView = ({ inventory, ingredients, transactions, users }: {
    inventory: Product[],
    ingredients: Ingredient[],
    transactions: Transaction[],
    users: User[]
}) => {
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('all'); // 'all', 'today', 'week', 'month', 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const filterEntriesByDate = <T extends { timestamp?: string }>(entries: T[], filterType: string, customStart: string, customEnd: string): T[] => {
      const getStartOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (filterType === 'all' || (filterType === 'custom' && !customStart && !customEnd)) {
        return entries;
      }

      return [...entries].filter(entry => {
        if (!entry.timestamp) return false;
        const entryDate = new Date(entry.timestamp);
        let startFilter: Date | null = null;
        let endFilter: Date | null = null;
        const now = new Date();

        switch (filterType) {
          case 'today':
            startFilter = getStartOfDay(now);
            endFilter = new Date(startFilter);
            endFilter.setDate(endFilter.getDate() + 1);
            break;
          case 'week':
            const firstDayOfWeek = new Date(now);
            firstDayOfWeek.setDate(now.getDate() - now.getDay()); // Sunday is the first day
            startFilter = getStartOfDay(firstDayOfWeek);
            endFilter = new Date(startFilter);
            endFilter.setDate(endFilter.getDate() + 7);
            break;
          case 'month':
            startFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            endFilter = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
          case 'custom':
            if (customStart) startFilter = new Date(customStart);
            if (customEnd) {
              endFilter = new Date(customEnd);
              endFilter.setDate(endFilter.getDate() + 1); // Make it exclusive of the next day's start
            }
            break;
        }

        if (startFilter && entryDate < startFilter) return false;
        if (endFilter && entryDate >= endFilter) return false;
        return true;
      });
  };

  const filteredTransactions = useMemo(() => {
    return filterEntriesByDate(transactions, filterType, customStartDate, customEndDate);
  }, [transactions, filterType, customStartDate, customEndDate]);

  const filteredMiscCosts = useMemo(() => {
    return filterEntriesByDate(inventory.filter(i => i.type === 'MISC_COST'), filterType, customStartDate, customEndDate);
  }, [inventory, filterType, customStartDate, customEndDate]);


  const stats = useMemo(() => {
    const totalRevenue = filteredTransactions
        .filter(t => !t.isEmployeeMeal)
        .reduce((sum, t) => sum + t.total, 0);

    const totalCostOfGoodsSold = filteredTransactions.flatMap(t => t.items).reduce((sum, item) => {
      let itemCost = 0;
      if (item.type === 'PRODUCT') {
          const product = inventory.find(p => p.id === item.itemId);
          if (product && product.recipe) {
              itemCost = calculateProductCost(product.recipe, ingredients);
          }
      } else { // INGREDIENT
          const ingredient = ingredients.find(i => i.id === item.itemId);
          if (ingredient) {
              itemCost = getIngredientAverageCost(ingredient);
          }
      }
      return sum + (itemCost * item.quantity);
    }, 0);

    const grossProfit = totalRevenue - totalCostOfGoodsSold;
    
    // Labor cost calculation from MISC_COST items
    const totalLaborCost = filteredMiscCosts
        .filter(item => item.name.startsWith("Labor Cost:"))
        .reduce((sum, item) => sum + item.cost, 0);

    const otherMiscCosts = filteredMiscCosts
        .filter(item => !item.name.startsWith("Labor Cost:"))
        .reduce((sum, item) => sum + item.cost, 0);
    
    const totalOperatingCosts = otherMiscCosts + totalLaborCost;
    const netProfit = grossProfit - totalOperatingCosts;

    const ingredientsValue = ingredients.reduce((sum, i) => {
        const totalStock = getIngredientTotalStock(i);
        const avgCost = getIngredientAverageCost(i);
        return sum + (avgCost * totalStock);
    }, 0);
    

    return { totalRevenue, grossProfit, netProfit, totalLaborCost, totalOperatingCosts, productCount: inventory.filter(p => p.type === 'PRODUCT').length };
  }, [inventory, ingredients, filteredTransactions, filteredMiscCosts]);

  const lowStockIngredients = useMemo(() => {
    return ingredients.filter(i => {
        const totalStock = getIngredientTotalStock(i);
        return i.lowStockThreshold > 0 && totalStock <= i.lowStockThreshold
    });
  }, [ingredients]);

  const handleFilterChange = (type: string) => {
    setFilterType(type);
    if (type !== 'custom') {
        setCustomStartDate('');
        setCustomEndDate('');
    }
  }

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setCustomStartDate(e.target.value);
      setFilterType('custom');
  }

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setCustomEndDate(e.target.value);
      setFilterType('custom');
  }

  const transactionListTitle = useMemo(() => {
    switch (filterType) {
        case 'today': return "Today's Transactions";
        case 'week': return "This Week's Transactions";
        case 'month': return "This Month's Transactions";
        case 'custom':
            if (customStartDate && customEndDate) return `Transactions from ${customStartDate} to ${customEndDate}`;
            if (customStartDate) return `Transactions from ${customStartDate}`;
            if (customEndDate) return `Transactions until ${customEndDate}`;
            return "Custom Range Transactions";
        default: return "All Transactions";
    }
  }, [filterType, customStartDate, customEndDate]);

  const downloadCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    const headers = ["Transaction ID", "Timestamp", "Is Employee Meal", "Payment Mode", "Notes", "Item Name", "Type", "Quantity", "Price Per Item", "Item Total", "Cost Per Item", "Item Profit"];
    csvContent += headers.join(",") + "\r\n";

    filteredTransactions.forEach(t => {
      t.items.forEach(item => {
        let costPerItem = 0;
        if (item.type === 'PRODUCT') {
            const product = inventory.find(p => p.id === item.itemId);
            costPerItem = product && product.recipe ? calculateProductCost(product.recipe, ingredients) : 0;
        } else {
            const ingredient = ingredients.find(i => i.id === item.itemId);
            costPerItem = ingredient ? getIngredientAverageCost(ingredient) : 0;
        }

        const itemTotal = item.price * item.quantity;
        const itemProfit = t.isEmployeeMeal ? - (costPerItem * item.quantity) : itemTotal - (costPerItem * item.quantity);

        const row = [
          t.id,
          new Date(t.timestamp).toLocaleString(),
          t.isEmployeeMeal ? 'Yes' : 'No',
          t.paymentMode || '',
          `"${(t.notes || '').replace(/"/g, '""')}"`,
          `"${item.name}"`,
          item.type,
          item.quantity,
          item.price.toFixed(2),
          t.isEmployeeMeal ? '0.00' : itemTotal.toFixed(2),
          costPerItem.toFixed(2),
          itemProfit.toFixed(2)
        ];
        csvContent += row.join(",") + "\r\n";
      });
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sales_data_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="dashboard-grid">
        <div className="stat-card">
          <h3>Total Revenue</h3>
          <p>{formatCurrency(stats.totalRevenue)}</p>
        </div>
        <div className="stat-card">
          <h3>Gross Profit</h3>
          <p>{formatCurrency(stats.grossProfit)}</p>
        </div>
        <div className="stat-card">
          <h3>Labor Cost</h3>
          <p>{formatCurrency(stats.totalLaborCost)}</p>
        </div>
         <div className="stat-card">
          <h3>Net Profit</h3>
          <p>{formatCurrency(stats.netProfit)}</p>
        </div>
        <div className="stat-card">
          <h3>Total Operating Costs</h3>
          <p>{formatCurrency(stats.totalOperatingCosts)}</p>
        </div>
        <div className="stat-card">
          <h3>Products for Sale</h3>
          <p>{stats.productCount}</p>
        </div>
      </div>

      <div className="low-stock-alerts">
        <h2>Low Stock Alerts</h2>
        {lowStockIngredients.length > 0 ? (
          <ul>
            {lowStockIngredients.map(ing => (
              <li key={ing.id}>
                <strong>{ing.name}</strong> is low on stock! Current stock: {getIngredientTotalStock(ing)} {ing.unit}. (Threshold: {ing.lowStockThreshold})
              </li>
            ))}
          </ul>
        ) : (
          <p>All inventory levels are good.</p>
        )}
      </div>

      <div className="date-filter-container">
          <h2>Filter Transactions</h2>
          <div className="date-filters">
            <button onClick={() => handleFilterChange('all')} className={filterType === 'all' ? 'active' : ''}>All Time</button>
            <button onClick={() => handleFilterChange('today')} className={filterType === 'today' ? 'active' : ''}>Today</button>
            <button onClick={() => handleFilterChange('week')} className={filterType === 'week' ? 'active' : ''}>This Week</button>
            <button onClick={() => handleFilterChange('month')} className={filterType === 'month' ? 'active' : ''}>This Month</button>
            <div className="custom-date-range">
                <label htmlFor="start-date">From:</label>
                <input type="date" id="start-date" value={customStartDate} onChange={handleStartDateChange} />
                <label htmlFor="end-date">To:</label>
                <input type="date" id="end-date" value={customEndDate} onChange={handleEndDateChange} />
            </div>
          </div>
      </div>

      <div className="recent-transactions">
        <div className="transactions-header">
            <h2>{transactionListTitle} ({filteredTransactions.length})</h2>
            <button className="btn btn-secondary" onClick={downloadCSV} disabled={filteredTransactions.length === 0}>Download CSV</button>
        </div>
        <ul className="transaction-list">
          {[...filteredTransactions].reverse().map(t => (
            <li key={t.id} className="transaction-item">
              <div className="transaction-item-header" onClick={() => setExpandedTxId(expandedTxId === t.id ? null : t.id)}>
                <span>{new Date(t.timestamp).toLocaleString()}</span>
                <strong>{formatCurrency(t.total)} {t.isEmployeeMeal && <span className="employee-meal-tag">Employee Meal</span>}</strong>
              </div>
               {expandedTxId === t.id && (
                <div className="transaction-item-details">
                  <strong>Items:</strong>
                  <ul>
                    {t.items.map((item, index) => (
                      <li key={`${item.itemId}-${index}`}>{item.name} (x{item.quantity})</li>
                    ))}
                  </ul>
                  {t.paymentMode && <p><strong>Payment Mode:</strong> {t.paymentMode}</p>}
                  {t.notes && <p><strong>Notes:</strong> {t.notes}</p>}
                </div>
              )}
            </li>
          ))}
           {filteredTransactions.length === 0 && <p>No transactions found for the selected period.</p>}
        </ul>
      </div>
    </div>
  );
};

const BulkEditModal = ({ isOpen, onClose, onSave, itemType, itemCount }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any, stockOp: string) => void;
    itemType: InventoryTab;
    itemCount: number;
}) => {
    const [formData, setFormData] = useState<any>({});
    const [stockOperation, setStockOperation] = useState('add');

    useEffect(() => {
        if (isOpen) {
            setFormData({});
            setStockOperation('add');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prev: any) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const cleanedData = Object.fromEntries(Object.entries(formData).filter(([_, v]) => v !== '' && v !== null));
        if (Object.keys(cleanedData).length > 0) {
            onSave(cleanedData, stockOperation);
        }
    };
    
    const isIngredient = itemType === 'INGREDIENTS';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Bulk Edit {itemCount} {itemType.toLowerCase().replace('_', ' ')}</h2>
                <p>Only fill fields you want to update for all selected items. Leave fields blank to keep existing values.</p>
                <form onSubmit={handleSubmit}>
                    {isIngredient && (
                        <>
                            <div className="form-group">
                                <label>Selling Price per Unit</label>
                                <input type="number" name="price" value={formData.price || ''} onChange={handleChange} min="0" step="0.01" placeholder="e.g., 15.00" />
                            </div>
                            <div className="form-group">
                                <label>Low Stock Alert Threshold</label>
                                <input type="number" name="lowStockThreshold" value={formData.lowStockThreshold || ''} onChange={handleChange} min="0" placeholder="e.g., 10" />
                            </div>
                            <div className="form-group">
                                <label>Stock Quantity</label>
                                <div className="stock-operation-group">
                                    <select value={stockOperation} onChange={e => setStockOperation(e.target.value)}>
                                        <option value="add">Add</option>
                                        <option value="subtract">Subtract</option>
                                    </select>
                                    <input type="number" name="stock" value={formData.stock || ''} onChange={handleChange} min="0" placeholder="Enter value" />
                                </div>
                                <small>Adds or subtracts stock as a new entry in history. Cost for this batch will be 0.</small>
                            </div>
                        </>
                    )}
                    {(itemType === 'PRODUCTS' || itemType === 'MISC') && (
                         <div className="form-group">
                            <label>{itemType === 'PRODUCTS' ? 'Price' : 'Cost'}</label>
                            <input type="number" name={itemType === 'PRODUCTS' ? 'price' : 'cost'} value={formData[itemType === 'PRODUCTS' ? 'price' : 'cost'] || ''} onChange={handleChange} min="0" step="0.01" />
                        </div>
                    )}
                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Apply Changes</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const NewStockCountView = ({ ingredients, setIngredients, setStockCounts, onSwitchTab }: {
    ingredients: Ingredient[];
    setIngredients: (ings: Ingredient[]) => void;
    setStockCounts: (counts: StockCount[] | ((prev: StockCount[]) => StockCount[])) => void;
    onSwitchTab: (tab: InventoryTab) => void;
}) => {
    const [countItems, setCountItems] = useState<StockCountItem[]>([]);

    useEffect(() => {
        setCountItems(ingredients.map(ing => ({
            ingredientId: ing.id,
            ingredientName: ing.name,
            unit: ing.unit,
            expectedStock: getIngredientTotalStock(ing),
            actualStock: '',
            unitCost: getIngredientAverageCost(ing),
        })));
    }, [ingredients]);

    const handleCountChange = (id: string, value: string) => {
        setCountItems(prev => prev.map(item =>
            item.ingredientId === id ? { ...item, actualStock: value === '' ? '' : parseFloat(value) } : item
        ));
    };

    const handleFinalizeCount = () => {
        if (!window.confirm("Are you sure you want to finalize this stock count? This will create a permanent record.")) return;

        let totalVarianceValue = 0;
        const finalItems = countItems.map(item => {
            const actual = typeof item.actualStock === 'number' ? item.actualStock : item.expectedStock;
            const variance = actual - item.expectedStock;
            totalVarianceValue += variance * item.unitCost;
            return { ...item, actualStock: actual };
        });

        const newCount: StockCount = {
            id: `sc_${Date.now()}`,
            timestamp: new Date().toISOString(),
            items: finalItems,
            totalVarianceValue,
        };

        setStockCounts(prev => [newCount, ...prev]);

        if (window.confirm("Stock count saved. Do you want to update your inventory levels to match this physical count? This will clear existing stock history for each item and replace it with a single entry reflecting the new count.")) {
            const updatedIngredients = ingredients.map(ing => {
                const countedItem = finalItems.find(ci => ci.ingredientId === ing.id);
                if (!countedItem) return ing;
                const newHistory: StockHistoryItem = {
                    date: new Date().toISOString(),
                    quantity: countedItem.actualStock,
                    unitCost: countedItem.unitCost, // Preserve average cost
                };
                return { ...ing, stockHistory: [newHistory] };
            });
            setIngredients(updatedIngredients);
        }

        onSwitchTab('STOCK_HISTORY');
    };

    const isFinalizeDisabled = countItems.some(item => item.actualStock === '');

    return (
        <div className="stock-count-container">
            <h3>Perform New Stock Count</h3>
            <p>Enter the actual physical quantity for each ingredient. Leave blank to assume no change. The system will calculate the variance.</p>
            <div className="inventory-table-container">
                 <table className="inventory-table stock-count-table">
                    <thead>
                        <tr>
                            <th>Ingredient</th>
                            <th>Unit</th>
                            <th>Expected Stock (System)</th>
                            <th>Actual Stock (Physical Count)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {countItems.map(item => (
                            <tr key={item.ingredientId}>
                                <td>{item.ingredientName}</td>
                                <td>{item.unit}</td>
                                <td>{item.expectedStock}</td>
                                <td>
                                    <input
                                        type="number"
                                        value={item.actualStock}
                                        onChange={(e) => handleCountChange(item.ingredientId, e.target.value)}
                                        placeholder="Enter count"
                                        min="0"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="stock-count-actions">
                <button className="btn btn-secondary" onClick={() => onSwitchTab('INGREDIENTS')}>Cancel</button>
                <button className="btn btn-primary" onClick={handleFinalizeCount}>
                    Finalize Count
                </button>
            </div>
        </div>
    );
};

const StockCountHistoryView = ({ stockCounts }: { stockCounts: StockCount[] }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <div className="stock-history-container">
            <h3>Stock Count History</h3>
            {stockCounts.length === 0 ? (
                <p>No stock counts have been performed yet.</p>
            ) : (
                <ul className="stock-history-list">
                    {stockCounts.map(count => {
                        const isExpanded = expandedId === count.id;
                        const varianceClass = count.totalVarianceValue > 0 ? 'variance-positive' : count.totalVarianceValue < 0 ? 'variance-negative' : '';
                        return (
                            <li key={count.id} className="stock-history-item">
                                <div className="stock-history-header" onClick={() => setExpandedId(isExpanded ? null : count.id)}>
                                    <span>{new Date(count.timestamp).toLocaleString()}</span>
                                    <span>Total Variance: <strong className={varianceClass}>{formatCurrency(count.totalVarianceValue)}</strong></span>
                                </div>
                                {isExpanded && (
                                    <div className="stock-history-details">
                                        <h4>Count Details</h4>
                                        <div className="inventory-table-container">
                                            <table className="inventory-table">
                                                <thead>
                                                    <tr>
                                                        <th>Ingredient</th>
                                                        <th>Expected</th>
                                                        <th>Actual</th>
                                                        <th>Variance (Units)</th>
                                                        <th>Variance (Value)</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {count.items.map(item => {
                                                        const variance = (typeof item.actualStock === 'number' ? item.actualStock : 0) - item.expectedStock;
                                                        const varianceValue = variance * item.unitCost;
                                                        const vClass = variance > 0 ? 'variance-positive' : variance < 0 ? 'variance-negative' : '';
                                                        return (
                                                            <tr key={item.ingredientId}>
                                                                <td>{item.ingredientName}</td>
                                                                <td>{item.expectedStock} {item.unit}</td>
                                                                <td>{item.actualStock} {item.unit}</td>
                                                                <td className={vClass}>{variance} {item.unit}</td>
                                                                <td className={vClass}>{formatCurrency(varianceValue)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};


const InventoryView = ({ inventory, setInventory, ingredients, setIngredients, stockCounts, setStockCounts }: {
    inventory: Product[], setInventory: (inv: Product[] | ((p: Product[]) => Product[])) => void,
    ingredients: Ingredient[], setIngredients: (ings: Ingredient[] | ((i: Ingredient[]) => Ingredient[])) => void,
    stockCounts: StockCount[], setStockCounts: (counts: StockCount[] | ((prev: StockCount[]) => StockCount[])) => void
}) => {
    const [isProductModalOpen, setIsProductModalOpen] = useState(false);
    const [isIngredientModalOpen, setIsIngredientModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);
    const [editingIngredient, setEditingIngredient] = useState<Ingredient | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<InventoryTab>('PRODUCTS');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
    const [expandedIngredientId, setExpandedIngredientId] = useState<string | null>(null);

    useEffect(() => {
        setSelectedItems(new Set()); // Reset selection when tab changes
        setExpandedIngredientId(null);
    }, [activeTab]);


    const handleProductSave = (product: Product) => {
        setInventory(prev =>
            prev.find(p => p.id === product.id)
                ? prev.map(p => p.id === product.id ? product : p)
                : [...prev, product]
        );
        setIsProductModalOpen(false);
        setEditingProduct(undefined);
    };

    const handleIngredientSave = (ingredient: Ingredient) => {
        setIngredients(prev =>
            prev.find(i => i.id === ingredient.id)
            ? prev.map(i => i.id === ingredient.id ? ingredient : i)
            : [...prev, ingredient]
        );
        setIsIngredientModalOpen(false);
        setEditingIngredient(undefined);
    }

    const handleDelete = (id: string) => {
        if (!window.confirm('Are you sure you want to delete this item? This action cannot be undone.')) return;

        if (activeTab === 'INGREDIENTS') {
            // Remove the ingredient itself
            setIngredients(prev => prev.filter(i => i.id !== id));
            // Also remove the ingredient from any product recipes that use it
            setInventory(prev => prev.map(p => ({
                ...p,
                recipe: p.recipe ? p.recipe.filter(r => r.ingredientId !== id) : []
            })));
        } else if (activeTab === 'PRODUCTS' || activeTab === 'MISC') {
            // Both Products and Misc Costs are stored in the main inventory state
            setInventory(prev => prev.filter(p => p.id !== id));
        }
    };

    const products = inventory.filter(p => p.type === 'PRODUCT');
    const miscCosts = inventory.filter(p => p.type === 'MISC_COST');

    let itemsToShow: any[] = [];
    if(activeTab === 'PRODUCTS') itemsToShow = products;
    if(activeTab === 'INGREDIENTS') itemsToShow = ingredients;
    if(activeTab === 'MISC') itemsToShow = miscCosts;

    const handleSelect = (id: string) => {
        setSelectedItems(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(id)) {
                newSelection.delete(id);
            } else {
                newSelection.add(id);
            }
            return newSelection;
        });
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedItems(new Set(itemsToShow.map(item => item.id)));
        } else {
            setSelectedItems(new Set());
        }
    };
    
    const handleBulkDelete = () => {
        if (window.confirm(`Are you sure you want to delete ${selectedItems.size} selected items? This action cannot be undone.`)) {
            if (activeTab === 'INGREDIENTS') {
                setIngredients(prev => prev.filter(i => !selectedItems.has(i.id)));
                // Also remove deleted ingredients from recipes
                setInventory(prev => prev.map(p => ({
                    ...p,
                    recipe: p.recipe ? p.recipe.filter(r => !selectedItems.has(r.ingredientId)) : []
                })));
            } else { // Products or Misc Costs
                setInventory(prev => prev.filter(p => !selectedItems.has(p.id)));
            }
            setSelectedItems(new Set());
        }
    };

    const handleBulkSave = (data: any, stockOp: string) => {
        const parseFloatOrUndefined = (val: any) => val !== undefined && val !== '' ? parseFloat(val) : undefined;
        const parseIntOrUndefined = (val: any) => val !== undefined && val !== '' ? parseInt(val, 10) : undefined;

        if (activeTab === 'INGREDIENTS') {
            const price = parseFloatOrUndefined(data.price);
            const lowStockThreshold = parseIntOrUndefined(data.lowStockThreshold);
            const stockValue = parseIntOrUndefined(data.stock);

            setIngredients(prev => prev.map(ing => {
                if (selectedItems.has(ing.id)) {
                    const newIng = {...ing, stockHistory: [...ing.stockHistory]};
                    if (price !== undefined) newIng.price = price;
                    if (lowStockThreshold !== undefined) newIng.lowStockThreshold = lowStockThreshold;

                    if (stockValue !== undefined && !isNaN(stockValue)) {
                        let quantity = stockOp === 'add' ? stockValue : -stockValue;
                        newIng.stockHistory.push({
                            date: new Date().toISOString(),
                            quantity: quantity,
                            unitCost: 0 // Cost is unknown in bulk edit
                        });
                    }
                    return newIng;
                }
                return ing;
            }));
        } else {
            const valueKey = activeTab === 'PRODUCTS' ? 'price' : 'cost';
            const newValue = parseFloatOrUndefined(data[valueKey]);
            if (newValue === undefined || isNaN(newValue)) {
                 setIsBulkEditModalOpen(false);
                 return;
            }
            setInventory(prev => prev.map(p => {
                if (selectedItems.has(p.id)) {
                    return { ...p, [valueKey]: newValue };
                }
                return p;
            }));
        }
        setIsBulkEditModalOpen(false);
        setSelectedItems(new Set());
    };
    
    const isDataTab = ['PRODUCTS', 'INGREDIENTS', 'MISC'].includes(activeTab);

    return (
        <div>
            {isProductModalOpen && <ProductModal product={editingProduct} ingredients={ingredients} onClose={() => {setIsProductModalOpen(false); setEditingProduct(undefined);}} onSave={handleProductSave} />}
            {isIngredientModalOpen && <IngredientModal ingredient={editingIngredient} ingredients={ingredients} onClose={() => {setIsIngredientModalOpen(false); setEditingIngredient(undefined)}} onSave={handleIngredientSave} />}
            <BulkEditModal isOpen={isBulkEditModalOpen} onClose={() => setIsBulkEditModalOpen(false)} onSave={handleBulkSave} itemType={activeTab} itemCount={selectedItems.size} />
            
            <div className="inventory-header">
                <h2>Inventory & Costs</h2>
                { isDataTab && (
                     <button
                        className="btn btn-primary"
                        onClick={() => {
                           if (activeTab === 'INGREDIENTS') {
                               setEditingIngredient(undefined);
                               setIsIngredientModalOpen(true);
                           } else {
                               setEditingProduct(undefined);
                               setIsProductModalOpen(true);
                           }
                        }}>
                        {activeTab === 'INGREDIENTS' ? 'Add New Ingredient' : 'Add New Item'}
                    </button>
                )}
            </div>

            <div className="inventory-tabs">
                <button onClick={() => setActiveTab('PRODUCTS')} className={`tab-btn ${activeTab === 'PRODUCTS' ? 'active' : ''}`}>Products for Sale ({products.length})</button>
                <button onClick={() => setActiveTab('INGREDIENTS')} className={`tab-btn ${activeTab === 'INGREDIENTS' ? 'active' : ''}`}>Ingredients ({ingredients.length})</button>
                <button onClick={() => setActiveTab('MISC')} className={`tab-btn ${activeTab === 'MISC' ? 'active' : ''}`}>Miscellaneous Costs ({miscCosts.length})</button>
                <button onClick={() => setActiveTab('STOCK_COUNT')} className={`tab-btn ${activeTab === 'STOCK_COUNT' ? 'active' : ''}`}>Perform Stock Count</button>
                <button onClick={() => setActiveTab('STOCK_HISTORY')} className={`tab-btn ${activeTab === 'STOCK_HISTORY' ? 'active' : ''}`}>Stock Count History</button>
            </div>
            
            {selectedItems.size > 0 && (
                <div className="bulk-actions-bar">
                    <span>{selectedItems.size} items selected</span>
                    <div className="bulk-actions-buttons">
                        <button className="btn btn-secondary" onClick={() => setIsBulkEditModalOpen(true)}>Edit Selected</button>
                        <button className="btn btn-danger" onClick={handleBulkDelete}>Delete Selected</button>
                    </div>
                </div>
            )}

            {isDataTab ? (
                <div className="inventory-table-container">
                    <table className="inventory-table">
                        <thead>
                            <tr>
                                <th className="select-column"><input type="checkbox" onChange={handleSelectAll} checked={itemsToShow.length > 0 && selectedItems.size === itemsToShow.length}/></th>
                                <th>Name</th>
                                {(activeTab === 'PRODUCTS' || activeTab === 'INGREDIENTS') && <th>Price</th>}
                                {activeTab === 'INGREDIENTS' && <th>Unit</th>}
                                <th>Cost</th>
                                {activeTab !== 'MISC' && <th>Stock</th>}
                                {activeTab === 'INGREDIENTS' && <th>Alert Threshold</th>}
                                <th className="actions-column">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {itemsToShow.length > 0 ? itemsToShow.map(item => {
                                const isProduct = activeTab === 'PRODUCTS';
                                const isIngredient = activeTab === 'INGREDIENTS';
                                const totalStock = isIngredient ? getIngredientTotalStock(item) : (isProduct ? calculateProductStock(item.recipe, ingredients) : null);
                                const avgCost = isIngredient ? getIngredientAverageCost(item) : (isProduct ? calculateProductCost(item.recipe, ingredients) : item.cost);
                                const isLowStock = isIngredient && item.lowStockThreshold > 0 && totalStock !== null && totalStock <= item.lowStockThreshold;
                                const isSelected = selectedItems.has(item.id);

                                return (
                                <React.Fragment key={item.id}>
                                    <tr className={`${isLowStock ? 'low-stock' : ''} ${isSelected ? 'selected' : ''}`}>
                                        <td><input type="checkbox" checked={isSelected} onChange={() => handleSelect(item.id)} /></td>
                                        <td>
                                          {isIngredient && (
                                              <button className="expand-btn" onClick={() => setExpandedIngredientId(expandedIngredientId === item.id ? null : item.id)}>
                                                  {expandedIngredientId === item.id ? '▼' : '▶'}
                                              </button>
                                          )}
                                          {item.name}
                                        </td>
                                        {(isProduct || isIngredient) && <td>{formatCurrency(item.price || 0)}</td>}
                                        {isIngredient && <td>{item.unit}</td>}
                                        <td>{formatCurrency(avgCost)} {isIngredient && ` per ${item.unit}`}</td>
                                        {activeTab !== 'MISC' && <td>{totalStock}</td>}
                                        {isIngredient && <td>{item.lowStockThreshold > 0 ? item.lowStockThreshold : 'Disabled'}</td>}
                                        <td>
                                            <div className="product-actions">
                                                <button className="btn btn-secondary" onClick={() => {
                                                    if (isIngredient) {
                                                        setEditingIngredient(item);
                                                        setIsIngredientModalOpen(true);
                                                    } else {
                                                        setEditingProduct(item);
                                                        setIsProductModalOpen(true);
                                                    }
                                                }}>Edit</button>
                                                <button className="btn btn-danger" onClick={() => handleDelete(item.id)}>Delete</button>
                                            </div>
                                        </td>
                                    </tr>
                                    {isIngredient && expandedIngredientId === item.id && (
                                        <tr className="stock-history-details-row">
                                            <td colSpan={8}>
                                                <div className="stock-history-details-content">
                                                  <h4>Stock History for {item.name}</h4>
                                                  {item.stockHistory.length > 0 ? (
                                                    <table className="stock-history-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Date Added</th>
                                                                <th>Quantity</th>
                                                                <th>Cost per Unit</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                          {[...item.stockHistory].reverse().map((entry, index) => (
                                                              <tr key={index}>
                                                                  <td>{new Date(entry.date).toLocaleString()}</td>
                                                                  <td>{entry.quantity} {item.unit}</td>
                                                                  <td>{formatCurrency(entry.unitCost)}</td>
                                                              </tr>
                                                          ))}
                                                        </tbody>
                                                    </table>
                                                  ) : (
                                                    <p>No stock history found.</p>
                                                  )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                  </React.Fragment>
                                )
                            }) : (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center' }}>No items to display.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            ) : activeTab === 'STOCK_COUNT' ? (
                <NewStockCountView ingredients={ingredients} setIngredients={setIngredients} setStockCounts={setStockCounts} onSwitchTab={setActiveTab} />
            ) : (
                <StockCountHistoryView stockCounts={stockCounts} />
            )}
        </div>
    );
};

const CartView = ({
    cart,
    setCart,
    allSellableItems,
    stockErrorItemId,
    updateCartQuantity,
    taxes,
    notes,
    setNotes,
    handlePayment,
    handleEmployeeMeal,
    currentUser,
    openShift,
    handleTimeClock
}: {
    cart: CartItem[],
    setCart: (cart: CartItem[]) => void,
    allSellableItems: any[],
    stockErrorItemId: string | null,
    updateCartQuantity: (itemId: string, amount: number) => void,
    taxes: Tax[],
    notes: string,
    setNotes: (notes: string) => void,
    handlePayment: (mode: 'Cash' | 'E-Payment') => void,
    handleEmployeeMeal: () => void,
    currentUser: User,
    openShift: TimeClockEntry | undefined,
    handleTimeClock: () => void,
}) => {
    const cartSubtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
    const taxBreakdown = useMemo(() => taxes.map(tax => ({ ...tax, amount: cartSubtotal * (tax.rate / 100) })), [cartSubtotal, taxes]);
    const totalTax = useMemo(() => taxBreakdown.reduce((sum, tax) => sum + tax.amount, 0), [taxBreakdown]);
    const total = cartSubtotal + totalTax;

    return (
        <div className="cart">
            <div className="time-clock-widget">
                {openShift ? (
                    <div className="time-clock-status clocked-in">
                        Clocked In since {new Date(openShift.startTime).toLocaleTimeString()}
                    </div>
                ) : (
                    <div className="time-clock-status clocked-out">
                        Clocked Out
                    </div>
                )}
                <button className="btn btn-secondary time-clock-btn" onClick={handleTimeClock}>
                    {openShift ? 'Time Out' : 'Time In'}
                </button>
            </div>
            <h2>Cart</h2>
            <div className="cart-items">
                {cart.map(item => {
                     const sellableItem = allSellableItems.find(p => p.id === item.itemId);
                     const maxStockReached = sellableItem ? item.quantity >= sellableItem.stock : true;

                     return (
                        <div key={item.itemId} className={`cart-item ${stockErrorItemId === item.itemId ? 'shake-error' : ''}`}>
                            <div className="cart-item-details">
                                <strong>{item.name}</strong>
                                <p>{formatCurrency(item.price)} x {item.quantity}</p>
                            </div>
                            <div className="cart-item-actions">
                                <button onClick={() => updateCartQuantity(item.itemId, -1)}>-</button>
                                <span>{item.quantity}</span>
                                <button onClick={() => updateCartQuantity(item.itemId, 1)} disabled={maxStockReached}>+</button>
                            </div>
                        </div>
                     );
                })}
                 {cart.length === 0 && <p>Cart is empty</p>}
            </div>
            {cart.length > 0 && (
                <div className="cart-summary">
                    <div className="summary-row">
                        <span>Subtotal</span>
                        <span>{formatCurrency(cartSubtotal)}</span>
                    </div>
                    {taxBreakdown.map(tax => (
                        <div className="summary-row" key={tax.id}>
                            <span>{tax.name} ({tax.rate}%)</span>
                            <span>{formatCurrency(tax.amount)}</span>
                        </div>
                    ))}
                    <div className="summary-row total">
                        <span>Total</span>
                        <span>{formatCurrency(total)}</span>
                    </div>
                    <div className="form-group transaction-notes">
                        <label htmlFor="notes">Transaction Notes</label>
                        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g., Customer request, promo..."></textarea>
                    </div>
                    <div className="cart-actions-container">
                        <div className="payment-buttons">
                            <button className="btn btn-checkout" onClick={() => handlePayment('Cash')}>Pay with Cash</button>
                            <button className="btn btn-checkout" onClick={() => handlePayment('E-Payment')}>Pay with E-Payment</button>
                        </div>
                        <div className="utility-buttons">
                            <button className="btn btn-secondary" onClick={handleEmployeeMeal}>Free Employee Meal</button>
                            <button className="btn btn-secondary" onClick={() => setCart([])}>Clear Cart</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

type KitchenOrderTicketProps = {
    order: KitchenOrder;
    onComplete: (id: string) => void;
    onCancel: (id: string) => void;
};

// FIX: Explicitly type as a React.FC to ensure the 'key' prop is handled correctly by TypeScript.
const KitchenOrderTicket: React.FC<KitchenOrderTicketProps> = ({ order, onComplete, onCancel }) => {
    const elapsedTime = useTimer(order.timestamp);

    return (
        <div className="kitchen-order-ticket">
            <div className="ticket-header">
                <h3>Order #{order.orderNumber}</h3>
                <span className="ticket-timer">{elapsedTime}</span>
            </div>
            <ul className="ticket-items">
                {order.items.map((item, index) => (
                    <li key={index}>{item.quantity}x {item.name}</li>
                ))}
            </ul>
            <div className="ticket-actions">
                <button className="btn btn-danger" onClick={() => onCancel(order.id)}>Cancel</button>
                <button className="btn btn-success" onClick={() => onComplete(order.id)}>Complete</button>
            </div>
        </div>
    );
};

const KitchenQueue = ({ orders, onComplete, onCancel }: { orders: KitchenOrder[], onComplete: (id: string) => void, onCancel: (id: string) => void }) => {
    return (
        <div className="kitchen-queue-container">
            <h2>Kitchen Queue</h2>
            <div className="kitchen-orders">
                {orders.length > 0 ? (
                    [...orders].map(order => (
                        <KitchenOrderTicket
                            key={order.id}
                            order={order}
                            onComplete={onComplete}
                            onCancel={onCancel}
                        />
                    ))
                ) : (
                    <p>No active orders.</p>
                )}
            </div>
        </div>
    );
};

const POSView = ({
    inventory, ingredients, setIngredients, addTransaction, taxes, currentUser,
    timeClockEntries, setTimeClockEntries, setInventory,
    kitchenOrders, addKitchenOrder, onCompleteOrder, onCancelOrder,
    lastOrderNumber, setLastOrderNumber
}: {
    inventory: Product[],
    ingredients: Ingredient[],
    setIngredients: React.Dispatch<React.SetStateAction<Ingredient[]>>,
    addTransaction: (t: Transaction) => void,
    taxes: Tax[],
    currentUser: User,
    timeClockEntries: TimeClockEntry[],
    setTimeClockEntries: React.Dispatch<React.SetStateAction<TimeClockEntry[]>>,
    setInventory: React.Dispatch<React.SetStateAction<Product[]>>,
    kitchenOrders: KitchenOrder[],
    addKitchenOrder: (order: KitchenOrder) => void,
    onCompleteOrder: (id: string) => void,
    onCancelOrder: (id: string) => void,
    lastOrderNumber: LastOrderNumber,
    setLastOrderNumber: (val: LastOrderNumber) => void,
}) => {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [stockErrorItemId, setStockErrorItemId] = useState<string | null>(null);
    const [notes, setNotes] = useState('');
    const [isMobile, setIsMobile] = useState(window.innerWidth < 992);
    const [mobileTab, setMobileTab] = useState<'menu' | 'cart' | 'queue'>('menu');

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 992);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const openShift = useMemo(() => timeClockEntries.find(e => e.userId === currentUser.id && !e.endTime), [timeClockEntries, currentUser]);

    const handleTimeClock = () => {
        if (openShift) { // Clocking out
            const endTime = new Date().toISOString();
            setTimeClockEntries(prev => prev.map(e =>
                e.id === openShift.id ? { ...e, endTime: endTime } : e
            ));
            
            if (currentUser.dailyRate && currentUser.dailyRate > 0) {
                 const start = new Date(openShift.startTime).getTime();
                 const end = new Date(endTime).getTime();
                 const durationHours = (end - start) / (1000 * 60 * 60);
                 const hourlyRate = currentUser.dailyRate / 12;
                 const paidHours = Math.min(durationHours, 12);
                 const cost = paidHours * hourlyRate;

                 const laborCostItem: Product = {
                    id: `misc_${Date.now()}`,
                    name: `Labor Cost: ${currentUser.name}`,
                    cost: cost,
                    type: 'MISC_COST',
                    price: 0,
                    recipe: [],
                    quantity: 1,
                    timestamp: endTime
                 };
                 setInventory(prev => [...prev, laborCostItem]);
            }

        } else { // Clocking in
            const newEntry: TimeClockEntry = {
                id: `tc_${Date.now()}`,
                userId: currentUser.id,
                startTime: new Date().toISOString(),
            };
            setTimeClockEntries(prev => [...prev, newEntry]);
        }
    };

    const { menuProducts, extraItems } = useMemo(() => {
        const menuProducts = inventory
            .filter(p => p.type === 'PRODUCT')
            .map(p => ({
                id: p.id,
                name: p.name,
                price: p.price,
                stock: calculateProductStock(p.recipe, ingredients),
                type: 'PRODUCT' as 'PRODUCT',
            }));

        const extraItems = ingredients
            .filter(i => i.price > 0)
            .map(i => ({
                id: i.id,
                name: i.name,
                price: i.price,
                stock: getIngredientTotalStock(i),
                type: 'INGREDIENT' as 'INGREDIENT',
            }));

        return { menuProducts, extraItems };
    }, [inventory, ingredients]);
    
    const allSellableItems = useMemo(() => [...menuProducts, ...extraItems], [menuProducts, extraItems]);

    const triggerStockError = (itemId: string) => {
        setStockErrorItemId(itemId);
        setTimeout(() => setStockErrorItemId(null), 400);
    };

    const addToCart = (item: { id: string; name: string; price: number; stock: number; type: 'PRODUCT' | 'INGREDIENT' }) => {
        const cartItem = cart.find(ci => ci.itemId === item.id);
        const currentCartQuantity = cartItem ? cartItem.quantity : 0;

        if (item.stock > currentCartQuantity) {
            setCart(currentCart => {
                const existingItem = currentCart.find(ci => ci.itemId === item.id);
                if (existingItem) {
                    return currentCart.map(ci =>
                        ci.itemId === item.id
                            ? { ...ci, quantity: ci.quantity + 1 }
                            : ci
                    );
                }
                return [...currentCart, { itemId: item.id, name: item.name, price: item.price, quantity: 1, type: item.type }];
            });
        } else {
            triggerStockError(item.id);
        }
    };

    const updateCartQuantity = (itemId: string, amount: number) => {
        const sellableItem = allSellableItems.find(p => p.id === itemId);
        if (!sellableItem) return;

        setCart(currentCart => {
            const item = currentCart.find(i => i.itemId === itemId);
            if(!item) return currentCart;

            const newQuantity = item.quantity + amount;

            if (newQuantity > sellableItem.stock) {
                 triggerStockError(itemId);
                 return currentCart;
            }
            if(newQuantity <= 0) {
                return currentCart.filter(i => i.itemId !== itemId);
            }
            return currentCart.map(i => i.itemId === itemId ? {...i, quantity: newQuantity} : i);
        });
    };

    const handleFinalizeTransaction = (details: Omit<Transaction, 'id' | 'items' | 'timestamp'>) => {
        // 1. Deduct inventory
        const updatedIngredients = [...ingredients].map(i => ({...i, stockHistory: [...i.stockHistory]}));

        cart.forEach(cartItem => {
            const processIngredient = (id: string, qty: number, avgCost: number) => {
                 const ingIndex = updatedIngredients.findIndex(i => i.id === id);
                 if (ingIndex > -1) {
                     updatedIngredients[ingIndex].stockHistory.push({
                        date: new Date().toISOString(),
                        quantity: -qty,
                        unitCost: avgCost
                     });
                 }
            };
            
            if (cartItem.type === 'PRODUCT') {
                const product = inventory.find(p => p.id === cartItem.itemId);
                if(product && product.recipe) {
                    product.recipe.forEach(recipeItem => {
                        const ingredient = ingredients.find(i => i.id === recipeItem.ingredientId);
                        if(ingredient){
                            const quantityToDecrement = recipeItem.quantity * cartItem.quantity;
                            processIngredient(recipeItem.ingredientId, quantityToDecrement, getIngredientAverageCost(ingredient));
                        }
                    });
                }
            } else { // INGREDIENT
                 const ingredient = ingredients.find(i => i.id === cartItem.itemId);
                 if(ingredient){
                    processIngredient(cartItem.itemId, cartItem.quantity, getIngredientAverageCost(ingredient));
                 }
            }
        });

        setIngredients(updatedIngredients);

        // 2. Create transaction
        addTransaction({
            ...details,
            id: `trans_${Date.now()}`,
            items: cart,
            timestamp: new Date().toISOString()
        });
        
        // 3. Create Kitchen Order
        const today = new Date().toISOString().split('T')[0];
        let newOrderNumber = 1;
        if (lastOrderNumber.date === today) {
            newOrderNumber = lastOrderNumber.number + 1;
        }
        setLastOrderNumber({ date: today, number: newOrderNumber });
        
        addKitchenOrder({
            id: `ko_${Date.now()}`,
            orderNumber: newOrderNumber,
            timestamp: new Date().toISOString(),
            items: cart
        });


        // 4. Clear cart and notes
        setCart([]);
        setNotes('');
        setMobileTab('menu');
    };
    
    const handlePayment = (paymentMode: 'Cash' | 'E-Payment') => {
        handleFinalizeTransaction({
            total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
            paymentMode,
            notes,
            isEmployeeMeal: false
        });
    };

    const handleEmployeeMeal = () => {
        if (!window.confirm("Are you sure you want to process this as a free employee meal?")) return;
        handleFinalizeTransaction({
            total: 0,
            paymentMode: 'Internal',
            notes: `Employee Meal. ${notes}`,
            isEmployeeMeal: true,
        });
    };
    
    const ProductSelection = () => (
        <div className="product-selection">
            <div className="pos-section">
                <h2>Menu</h2>
                <div className="pos-product-grid">
                    {menuProducts.map(item => {
                        const cartItem = cart.find(ci => ci.itemId === item.id);
                        const remainingStock = item.stock - (cartItem?.quantity || 0);
                        const isDisabled = remainingStock <= 0;
                        return (
                            <div key={item.id} className={`pos-product-card ${isDisabled ? 'disabled' : ''} ${stockErrorItemId === item.id ? 'shake-error' : ''}`} onClick={() => !isDisabled && addToCart(item)}>
                                <h4>{item.name}</h4>
                                <p>{formatCurrency(item.price)}</p>
                                <small>Stock: {item.stock}</small>
                            </div>
                        )
                    })}
                </div>
            </div>
             <div className="pos-section">
                <h2>Extras</h2>
                <div className="pos-product-grid">
                   {extraItems.map(item => {
                        const cartItem = cart.find(ci => ci.itemId === item.id);
                        const remainingStock = item.stock - (cartItem?.quantity || 0);
                        const isDisabled = remainingStock <= 0;
                        return (
                            <div key={item.id} className={`pos-product-card ${isDisabled ? 'disabled' : ''} ${stockErrorItemId === item.id ? 'shake-error' : ''}`} onClick={() => !isDisabled && addToCart(item)}>
                                <h4>{item.name}</h4>
                                <p>{formatCurrency(item.price)}</p>
                                <small>Stock: {item.stock}</small>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <div className="pos-container-mobile">
                <div className="pos-mobile-tabs">
                    <button onClick={() => setMobileTab('menu')} className={mobileTab === 'menu' ? 'active' : ''}>Menu</button>
                    <button onClick={() => setMobileTab('cart')} className={mobileTab === 'cart' ? 'active' : ''}>Cart ({cart.reduce((sum, i) => sum + i.quantity, 0)})</button>
                    <button onClick={() => setMobileTab('queue')} className={mobileTab === 'queue' ? 'active' : ''}>Queue ({kitchenOrders.length})</button>
                </div>
                <div className="pos-mobile-content">
                    {mobileTab === 'menu' && <ProductSelection />}
                    {mobileTab === 'cart' && <CartView cart={cart} setCart={setCart} allSellableItems={allSellableItems} stockErrorItemId={stockErrorItemId} updateCartQuantity={updateCartQuantity} taxes={taxes} notes={notes} setNotes={setNotes} handlePayment={handlePayment} handleEmployeeMeal={handleEmployeeMeal} currentUser={currentUser} openShift={openShift} handleTimeClock={handleTimeClock} />}
                    {mobileTab === 'queue' && <KitchenQueue orders={kitchenOrders} onComplete={onCompleteOrder} onCancel={onCancelOrder} />}
                </div>
            </div>
        );
    }

    return (
        <div className="pos-container">
            <ProductSelection />
            <CartView
                cart={cart} setCart={setCart} allSellableItems={allSellableItems} stockErrorItemId={stockErrorItemId}
                updateCartQuantity={updateCartQuantity} taxes={taxes} notes={notes} setNotes={setNotes}
                handlePayment={handlePayment} handleEmployeeMeal={handleEmployeeMeal} currentUser={currentUser}
                openShift={openShift} handleTimeClock={handleTimeClock}
            />
            <KitchenQueue orders={kitchenOrders} onComplete={onCompleteOrder} onCancel={onCancelOrder} />
        </div>
    );
};

const SettingsView = ({
    users, setUsers,
    taxes, onTaxesChange,
    onDownloadTemplate, onImportData
}: {
    users: User[];
    setUsers: (users: User[] | ((prev: User[]) => User[])) => void;
    taxes: Tax[];
    onTaxesChange: (newTaxes: Tax[]) => void;
    onDownloadTemplate: () => void;
    onImportData: (file: File | null) => Promise<{ message: string }>;
}) => {
    // Admin password state (for the Admin user)
    const adminUser = users.find(u => u.role === 'Admin');
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });

    // Employee Management State
    const [editingEmployee, setEditingEmployee] = useState<User | null>(null);
    const [employeeForm, setEmployeeForm] = useState({ id: '', name: '', pin: '', dailyRate: '' });
    const [employeeError, setEmployeeError] = useState('');

    // Tax State
    const [newTaxName, setNewTaxName] = useState('');
    const [newTaxRate, setNewTaxRate] = useState<number | ''>('');

    // Import/Export State
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importMessage, setImportMessage] = useState({ type: '', text: '' });
    const [isImporting, setIsImporting] = useState(false);

    const handlePasswordSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordMessage({ type: '', text: '' });

        if (!adminUser || oldPassword !== adminUser.pin) {
            setPasswordMessage({ type: 'error', text: 'Current PIN does not match.' });
            return;
        }
        if (!/^\d{4}$/.test(newPassword)) {
            setPasswordMessage({ type: 'error', text: 'New PIN must be exactly 4 digits.' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: 'error', text: 'New PINs do not match.' });
            return;
        }

        setUsers(prev => prev.map(u => u.id === adminUser.id ? { ...u, pin: newPassword } : u));
        setPasswordMessage({ type: 'success', text: 'Admin PIN updated successfully!' });
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
    };
    
    // Employee Handlers
    const handleEmployeeFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEmployeeForm(prev => ({ ...prev, [name]: value }));
    };

    const handleEditEmployee = (employee: User) => {
        setEditingEmployee(employee);
        setEmployeeForm({ id: employee.id, name: employee.name, pin: employee.pin, dailyRate: String(employee.dailyRate || '') });
    };
    
    const handleCancelEdit = () => {
        setEditingEmployee(null);
        setEmployeeForm({ id: '', name: '', pin: '', dailyRate: '' });
        setEmployeeError('');
    };

    const handleEmployeeSave = (e: React.FormEvent) => {
        e.preventDefault();
        setEmployeeError('');

        if (!employeeForm.name || !employeeForm.pin) {
            setEmployeeError('Name and PIN are required.');
            return;
        }
        if (!/^\d{4}$/.test(employeeForm.pin)) {
            setEmployeeError('PIN must be exactly 4 digits.');
            return;
        }

        if (editingEmployee) { // Update
            setUsers(prev => prev.map(u => u.id === editingEmployee.id ? { ...u, ...employeeForm, dailyRate: parseFloat(employeeForm.dailyRate) || 0 } : u));
        } else { // Add new
            const newUser: User = {
                id: `user_${Date.now()}`,
                name: employeeForm.name,
                pin: employeeForm.pin,
                role: 'Employee',
                dailyRate: parseFloat(employeeForm.dailyRate) || 0,
            };
            setUsers(prev => [...prev, newUser]);
        }
        handleCancelEdit();
    };

    const handleDeleteEmployee = (id: string) => {
        if (window.confirm("Are you sure you want to delete this employee?")) {
            setUsers(prev => prev.filter(u => u.id !== id));
        }
    };

    // Tax Handlers
    const handleAddTax = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaxName || newTaxRate === '') {
            return;
        }

        // FIX: Explicitly convert to a number to fix type error on the comparison below.
        const rate = Number(newTaxRate);

        if (rate < 0) {
            return;
        }

        const newTax: Tax = { id: `tax_${Date.now()}`, name: newTaxName, rate: rate };
        onTaxesChange([...taxes, newTax]);
        setNewTaxName('');
        setNewTaxRate('');
    };

    const handleDeleteTax = (id: string) => {
        onTaxesChange(taxes.filter(t => t.id !== id));
    };

    // Import Handlers
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setImportFile(e.target.files[0]);
        }
    };

    const handleImportClick = async () => {
        if (!importFile) {
            setImportMessage({ type: 'error', text: 'Please select a file.' });
            return;
        }
        setIsImporting(true);
        setImportMessage({ type: '', text: '' });
        try {
            const result = await onImportData(importFile);
            setImportMessage({ type: 'success', text: result.message });
        } catch (error: any) {
            setImportMessage({ type: 'error', text: error.message || 'An unknown error occurred.' });
        } finally {
            setIsImporting(false);
            setImportFile(null);
            const fileInput = document.getElementById('csv-import') as HTMLInputElement;
            if (fileInput) fileInput.value = '';
        }
    };

    return (
        <div className="settings-container">
            <h2>Settings</h2>
            <div className="settings-grid">
                <div className="settings-card">
                    <h3>Change Admin PIN</h3>
                    <form onSubmit={handlePasswordSubmit}>
                        <div className="form-group">
                            <label htmlFor="oldPassword">Current PIN</label>
                            <input type="password" id="oldPassword" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required maxLength={4} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="newPassword">New PIN</label>
                            <input type="password" id="newPassword" value={newPassword} onChange={e => setNewPassword(e.target.value)} required maxLength={4} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="confirmPassword">Confirm New PIN</label>
                            <input type="password" id="confirmPassword" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required maxLength={4} />
                        </div>
                        {passwordMessage.text && <p className={`settings-message ${passwordMessage.type}`}>{passwordMessage.text}</p>}
                        <button type="submit" className="btn btn-primary">Update PIN</button>
                    </form>
                </div>
                
                 <div className="settings-card">
                    <h3>Manage Employees</h3>
                    <ul className="employee-list">
                        {users.filter(u => u.role === 'Employee').map(user => (
                            <li key={user.id} className="employee-item">
                                <span>{user.name} - Rate: {formatCurrency(user.dailyRate || 0)}/day</span>
                                <div className="employee-actions">
                                    <button onClick={() => handleEditEmployee(user)}>Edit</button>
                                    <button onClick={() => handleDeleteEmployee(user.id)}>&times;</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <form onSubmit={handleEmployeeSave} className="employee-form">
                        <h4>{editingEmployee ? 'Edit Employee' : 'Add New Employee'}</h4>
                        {employeeError && <p className="form-error">{employeeError}</p>}
                        <input type="text" name="name" placeholder="Full Name" value={employeeForm.name} onChange={handleEmployeeFormChange} required />
                        <input type="password" name="pin" placeholder="4-Digit PIN" value={employeeForm.pin} onChange={handleEmployeeFormChange} required maxLength={4} />
                        <input type="number" name="dailyRate" placeholder="Daily Rate (Php)" value={employeeForm.dailyRate} onChange={handleEmployeeFormChange} required min="0" step="0.01" />
                        <div className="employee-form-actions">
                            {editingEmployee && <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>Cancel</button>}
                            <button type="submit" className="btn btn-primary">{editingEmployee ? 'Save Changes' : 'Add Employee'}</button>
                        </div>
                    </form>
                </div>

                <div className="settings-card">
                    <h3>Tax Settings</h3>
                    <ul className="tax-list">
                       {taxes.map(tax => (
                           <li key={tax.id} className="tax-item">
                               <span>{tax.name} ({tax.rate}%)</span>
                               <button onClick={() => handleDeleteTax(tax.id)} title="Delete Tax">&times;</button>
                           </li>
                       ))}
                       {taxes.length === 0 && <p>No taxes configured.</p>}
                    </ul>
                    <form onSubmit={handleAddTax} className="add-tax-form">
                       <input type="text" placeholder="Tax Name (e.g., VAT)" value={newTaxName} onChange={e => setNewTaxName(e.target.value)} required/>
                       <input type="number" placeholder="Rate %" value={newTaxRate} onChange={e => setNewTaxRate(e.target.value === '' ? '' : parseFloat(e.target.value))} required min="0" step="0.01"/>
                       <button type="submit" className="btn btn-primary">Add</button>
                    </form>
                </div>

                <div className="settings-card">
                    <h3>Data Management</h3>
                    <div className="data-management-section">
                        <h4>Download Template</h4>
                        <div className="template-buttons">
                            <button className="btn btn-secondary" onClick={onDownloadTemplate}>Download Unified Data Template</button>
                        </div>
                    </div>
                     <div className="data-management-section">
                        <h4>Import Data from CSV</h4>
                         <p><small>Use the unified data template to import ingredients, products, and miscellaneous costs all at once.</small></p>
                         <div className="import-controls">
                            <input type="file" id="csv-import" accept=".csv" onChange={handleFileChange} />
                            <button className="btn btn-primary" onClick={handleImportClick} disabled={isImporting}>
                                {isImporting ? 'Importing...' : 'Import Data'}
                            </button>
                         </div>
                         {importMessage.text && <p className={`settings-message ${importMessage.type}`}>{importMessage.text}</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const PinModal = ({ user, onLogin, onBack, onClose }: { user: User, onLogin: (pin: string) => boolean, onBack: () => void, onClose: () => void }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);

    useEffect(() => {
        if (pin.length === 4) {
            const success = onLogin(pin);
            if (!success) {
                setError(true);
                setTimeout(() => {
                    setPin('');
                    setError(false);
                }, 800);
            }
        }
    }, [pin, onLogin]);

    const handleKeyClick = (key: string) => {
        if (pin.length >= 4) return;
        setPin(prev => prev + key);
    };

    const handleBackspace = () => {
        setPin(prev => prev.slice(0, -1));
    };

    return (
        <div className="modal-overlay pin-modal-overlay" onClick={onClose}>
            <div className="modal-content pin-modal-content" onClick={e => e.stopPropagation()}>
                <h2>Enter PIN for {user.name}</h2>
                <div className={`pin-input ${error ? 'error' : ''}`}>
                    <span className={pin.length > 0 ? 'filled' : ''}></span>
                    <span className={pin.length > 1 ? 'filled' : ''}></span>
                    <span className={pin.length > 2 ? 'filled' : ''}></span>
                    <span className={pin.length > 3 ? 'filled' : ''}></span>
                </div>
                {error && <p className="login-error">Incorrect PIN</p>}
                <div className="pin-keypad">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => (
                        <button key={k} className="keypad-btn" onClick={() => handleKeyClick(String(k))}>{k}</button>
                    ))}
                    <button className="keypad-btn" onClick={onBack}>Back</button>
                    <button className="keypad-btn" onClick={() => handleKeyClick('0')}>0</button>
                    <button className="keypad-btn" onClick={handleBackspace}>&larr;</button>
                </div>
            </div>
        </div>
    );
};

const UserSelectionScreen = ({ users, onUserSelect }: { users: User[], onUserSelect: (user: User) => void }) => {
    return (
        <div className="user-selection-container">
            <div className="user-selection-screen">
                <h2>Select User</h2>
                <div className="user-grid">
                    {users.map(user => (
                        <button key={user.id} className="user-btn" onClick={() => onUserSelect(user)}>
                            {user.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App = () => {
  const { inventory, transactions, ingredients } = getInitialData();
  const [inventoryState, setInventoryState] = useLocalStorage<Product[]>('pos-inventory', inventory);
  const [ingredientsState, setIngredientsState] = useLocalStorage<Ingredient[]>('pos-ingredients', ingredients);
  const [transactionsState, setTransactionsState] = useLocalStorage<Transaction[]>('pos-transactions', transactions);
  const [taxesState, setTaxesState] = useLocalStorage<Tax[]>('pos-taxes', [{id: 'tax_default', name: 'Sales Tax', rate: 0}]);
  const [stockCounts, setStockCounts] = useLocalStorage<StockCount[]>('pos-stock-counts', []);
  const [timeClockEntries, setTimeClockEntries] = useLocalStorage<TimeClockEntry[]>('pos-time-clock', []);
  const [kitchenOrders, setKitchenOrders] = useLocalStorage<KitchenOrder[]>('pos-kitchen-orders', []);
  const [lastOrderNumber, setLastOrderNumber] = useLocalStorage<LastOrderNumber>('pos-last-order-number', { date: '', number: 0 });


  // User Authentication State
  const [users, setUsers] = useLocalStorage<User[]>('pos-users', [{ id: 'admin_default', name: 'Admin', pin: '1111', role: 'Admin' }]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null); // For PIN modal
  const [viewAs, setViewAs] = useState<'Admin' | 'Employee' | null>(null);

  const [activeView, setActiveView] = useState<AdminView>('DASHBOARD');

  const handleUserSelect = (user: User) => {
    setSelectedUser(user);
  };
  
  const handleLogin = (pin: string): boolean => {
      if (selectedUser && selectedUser.pin === pin) {
          setCurrentUser(selectedUser);
          setViewAs(selectedUser.role);
          setSelectedUser(null);
          if (selectedUser.role === 'Employee') {
              setActiveView('POS');
          }
          return true;
      }
      return false;
  };
  
  const handleLogout = () => {
    setCurrentUser(null);
    setSelectedUser(null);
    setViewAs(null);
    setActiveView('DASHBOARD');
  };
  
  const handleViewSwitch = () => {
      if (viewAs === 'Admin') {
          setViewAs('Employee');
          setActiveView('POS');
      } else {
          setViewAs('Admin');
          setActiveView('DASHBOARD');
      }
  };

  const addTransaction = (transaction: Transaction) => {
    setTransactionsState(prev => [...prev, transaction]);
  };
  
  const addKitchenOrder = (order: KitchenOrder) => {
    setKitchenOrders(prev => [...prev, order]);
  };
  
  const handleCompleteOrder = (id: string) => {
    setKitchenOrders(prev => prev.filter(o => o.id !== id));
  };
  
  const handleCancelOrder = (id: string) => {
    if (window.confirm("Are you sure you want to cancel this order from the queue?")) {
        setKitchenOrders(prev => prev.filter(o => o.id !== id));
    }
  };

  const handleDownloadTemplate = () => {
      const headers = [
        'item_type',
        'name',
        'unit',
        'price',
        'cost',
        'lowStockThreshold',
        'stock',
        'totalCost',
        'recipe'
      ];
      
      const sampleRows = [
        ['ingredient', 'Flour', 'g', '10', '', '1000', '5000', '250', ''],
        ['ingredient', 'Yeast Packet', 'pcs', '20', '', '10', '100', '500', ''],
        ['product', 'Bread Loaf', '', '60', '', '', '', '', '"500 Flour; 1 Yeast Packet"'],
        ['misc', 'Rent', '', '', '5000', '', '', '', '']
      ];

      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += headers.join(",") + "\r\n";
      sampleRows.forEach(rowArray => {
          let row = rowArray.join(",");
          csvContent += row + "\r\n";
      });

      const filename = `unified_data_template.csv`;
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };
  
   const handleImportData = (file: File | null): Promise<{ message: string }> => {
        return new Promise((resolve, reject) => {
            if (!file) return reject(new Error("No file selected."));

            const reader = new FileReader();
            reader.readAsText(file);

            reader.onerror = () => reject(new Error("Error reading file."));

            reader.onload = () => {
                const text = reader.result as string;
                const lines = text.split('\n').filter(line => line.trim() !== '');
                if (lines.length < 2) return reject(new Error("CSV file must have a header and at least one data row."));

                const headers = lines[0].split(',').map(h => h.trim().split(' ')[0]);
                
                const itemTypeHeaderIndex = headers.findIndex(h => h.toLowerCase() === 'item_type');
                if (itemTypeHeaderIndex === -1) {
                    return reject(new Error("Import failed: CSV must contain an 'item_type' column."));
                }
                
                const dataRows = lines.slice(1);

                const parsedData = dataRows.map(rowStr => {
                    // This is a simple CSV parser, may not handle commas in fields
                    const row = rowStr.split(',');
                    return headers.reduce((obj, header, index) => {
                        obj[header] = row[index]?.trim() || '';
                        return obj;
                    }, {} as Record<string, string>);
                });
                
                const newIngredients: Ingredient[] = [];
                const newProducts: Product[] = [];
                const newMiscCosts: Product[] = [];
                
                for (const row of parsedData) {
                    const type = row.item_type?.toLowerCase();

                    if (type === 'ingredient') {
                         if (!row.name || !row.unit) continue;
                         const stock = parseInt(row.stock, 10) || 0;
                         const totalCost = parseFloat(row.totalCost) || 0;
                         newIngredients.push({
                            id: `ing_${Date.now()}_${Math.random()}`,
                            name: row.name,
                            unit: row.unit,
                            price: parseFloat(row.price) || 0,
                            lowStockThreshold: parseInt(row.lowStockThreshold) || 0,
                            stockHistory: stock > 0 ? [{
                                date: new Date().toISOString(),
                                quantity: stock,
                                unitCost: stock > 0 ? totalCost / stock : 0
                            }] : []
                         });
                    } else if (type === 'product') {
                         if (!row.name) continue;
                         const recipeItems: RecipeItem[] = [];
                         if (row.recipe) {
                            const recipeParts = row.recipe.split(';').map((p:string) => p.trim());
                            for (const part of recipeParts) {
                                const [qtyStr, ...nameParts] = part.split(' ');
                                const name = nameParts.join(' ').trim().replace(/"/g, '');
                                const qty = parseFloat(qtyStr);
                                if (isNaN(qty) || !name) continue;

                                const ingredient = [...ingredientsState, ...newIngredients].find(i => i.name.toLowerCase() === name.toLowerCase());
                                if (ingredient) {
                                    recipeItems.push({ ingredientId: ingredient.id, quantity: qty });
                                } else {
                                    return reject(new Error(`Import failed on product "${row.name}": Ingredient '${name}' not found. Please add it to inventory first or include it in the same import file.`));
                                }
                            }
                         }
                         newProducts.push({
                            id: `prod_${Date.now()}_${Math.random()}`,
                            name: row.name,
                            price: parseFloat(row.price) || 0,
                            type: 'PRODUCT',
                            recipe: recipeItems,
                            cost: 0, // calculated
                            quantity: 0 // calculated
                         });
                    } else if (type === 'misc') {
                        if (!row.name) continue;
                        newMiscCosts.push({
                            id: `misc_${Date.now()}_${Math.random()}`,
                            name: row.name,
                            cost: parseFloat(row.cost) || 0,
                            type: 'MISC_COST',
                            price: 0,
                            recipe: [],
                            quantity: 1,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

                if (newIngredients.length > 0) {
                  setIngredientsState(prev => [...prev, ...newIngredients]);
                }
                if (newProducts.length > 0 || newMiscCosts.length > 0) {
                  setInventoryState(prev => [...prev, ...newProducts, ...newMiscCosts]);
                }

                const summary = [
                  newIngredients.length > 0 ? `${newIngredients.length} ingredients` : '',
                  newProducts.length > 0 ? `${newProducts.length} products` : '',
                  newMiscCosts.length > 0 ? `${newMiscCosts.length} misc costs` : ''
                ].filter(Boolean).join(', ');

                if (summary) {
                  resolve({ message: `Import successful: Added ${summary}.` });
                } else {
                  reject(new Error("No valid data found to import. Check item_type and required fields."));
                }
            };
        });
   };

  if (!currentUser) {
    return (
      <>
        <UserSelectionScreen users={users} onUserSelect={handleUserSelect} />
        {selectedUser && <PinModal user={selectedUser} onLogin={handleLogin} onBack={() => setSelectedUser(null)} onClose={() => setSelectedUser(null)} />}
      </>
    );
  }

  const isAdmin = currentUser.role === 'Admin';

  return (
    <div className="app-container">
      <header className={`app-header ${isAdmin && viewAs === 'Employee' ? 'employee-view-active' : ''}`}>
        <h1>La Luna POS</h1>
        {isAdmin && viewAs === 'Admin' && (
            <nav className="app-nav">
                <button onClick={() => setActiveView('DASHBOARD')} className={activeView === 'DASHBOARD' ? 'active' : ''}>Dashboard</button>
                <button onClick={() => setActiveView('POS')} className={activeView === 'POS' ? 'active' : ''}>POS</button>
                <button onClick={() => setActiveView('INVENTORY')} className={activeView === 'INVENTORY' ? 'active' : ''}>Inventory</button>
                <button onClick={() => setActiveView('SETTINGS')} className={activeView === 'SETTINGS' ? 'active' : ''}>Settings</button>
            </nav>
        )}
        <div className="header-controls">
            <span>Welcome, {currentUser.name} {isAdmin && viewAs === 'Employee' && '(Viewing as Employee)'}</span>
            {isAdmin && (
                <button className="btn btn-secondary view-switch-btn" onClick={handleViewSwitch}>
                    {viewAs === 'Admin' ? 'Employee View' : 'Admin View'}
                </button>
            )}
            <button className="btn btn-secondary" onClick={handleLogout}>Logout</button>
        </div>
      </header>
      <main className="main-content">
        {viewAs === 'Admin' && activeView === 'DASHBOARD' && <DashboardView inventory={inventoryState} ingredients={ingredientsState} transactions={transactionsState} users={users} />}
        {activeView === 'POS' && <POSView inventory={inventoryState} ingredients={ingredientsState} setIngredients={setIngredientsState} addTransaction={addTransaction} taxes={taxesState} currentUser={currentUser} timeClockEntries={timeClockEntries} setTimeClockEntries={setTimeClockEntries} setInventory={setInventoryState} kitchenOrders={kitchenOrders} addKitchenOrder={addKitchenOrder} onCompleteOrder={handleCompleteOrder} onCancelOrder={handleCancelOrder} lastOrderNumber={lastOrderNumber} setLastOrderNumber={setLastOrderNumber} />}
        {viewAs === 'Admin' && activeView === 'INVENTORY' && <InventoryView inventory={inventoryState} setInventory={setInventoryState} ingredients={ingredientsState} setIngredients={setIngredientsState} stockCounts={stockCounts} setStockCounts={setStockCounts} />}
        {viewAs === 'Admin' && activeView === 'SETTINGS' && <SettingsView users={users} setUsers={setUsers} taxes={taxesState} onTaxesChange={setTaxesState} onDownloadTemplate={handleDownloadTemplate} onImportData={handleImportData} />}
      </main>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}