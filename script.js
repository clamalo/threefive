import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  setPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC2BVISsDKOA7IGS-9TXfL6HIKDcxF5w1k",
  authDomain: "project-manager-3-prod.firebaseapp.com",
  databaseURL: "https://project-manager-3-prod-default-rtdb.firebaseio.com",
  projectId: "project-manager-3-prod",
  storageBucket: "project-manager-3-prod.firebasestorage.app",
  messagingSenderId: "943851094602",
  appId: "1:943851094602:web:14132a5b2ab15e26061cb3",
  measurementId: "G-9J2N6L5MK8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// Set up authentication persistence
const setupPersistence = async () => {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch (e) {
    console.log("Falling back to session persistence");
    try {
      await setPersistence(auth, browserSessionPersistence);
    } catch (e) {
      console.error("Could not set up persistence:", e);
    }
  }
};
setupPersistence();

// Task class for task management
class Task {
  constructor(id, name, completed = false, order = 0) {
    this.id = id;
    this.name = name;
    this.completed = completed;
    this.order = order;
  }
}

// Main App
const App = (() => {
  // State variables
  let tasks = [];
  let currentUser = null;
  let currentDate = new Date();
  let sortableInstance = null;
  const MIN_TASKS = 3;
  const MAX_TASKS = 5;
  
  // DOM Elements
  const signInButton = document.getElementById('sign-in-button');
  const signOutButton = document.getElementById('sign-out-button');
  const userMenu = document.getElementById('user-menu');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const addTaskButton = document.getElementById('add-task-button');
  const prevDayButton = document.getElementById('prev-day-button');
  const nextDayButton = document.getElementById('next-day-button');
  const todayButton = document.getElementById('today-button');
  const currentDateDisplay = document.getElementById('current-date');
  const emptyTasksMessage = document.getElementById('empty-tasks-message');
  const tasksContainer = document.getElementById('tasks-container');
  const appContainer = document.querySelector('.app-container');
  
  // Helper functions for date handling
  const formatDate = (date) => {
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  };
  
  const getDateKey = (date) => {
    return date.toISOString().split('T')[0];
  };
  
  const getTodayStr = () => getDateKey(new Date());
  
  const isToday = (dateToCheck) => {
    return getDateKey(dateToCheck) === getDateKey(new Date());
  };
  
  // Date navigation
  const changeDate = (days) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + days);
    setCurrentDate(newDate);
  };
  
  const setCurrentDate = (date) => {
    savePendingChanges();
    currentDate = date;
    updateDateDisplay();
    loadTasks();
  };
  
  const updateDateDisplay = () => {
    const isCurrentDateToday = isToday(currentDate);
    currentDateDisplay.textContent = isCurrentDateToday ? 'Today' : formatDate(currentDate);
    currentDateDisplay.classList.toggle('is-today', isCurrentDateToday);
    
    // Hide or show the "Go to Today" button based on whether the current date is today
    todayButton.style.display = isCurrentDateToday ? 'none' : 'block';
  };
  
  // Initialize the app
  const init = () => {
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      updateAuthUI();
      loadTasks();
    });
    
    // Set up event listeners
    signInButton.addEventListener('click', handleAuth);
    signOutButton.addEventListener('click', handleSignOut);
    addTaskButton.addEventListener('click', addNewTask);
    prevDayButton.addEventListener('click', () => changeDate(-1));
    nextDayButton.addEventListener('click', () => changeDate(1));
    todayButton.addEventListener('click', () => setCurrentDate(new Date()));
    
    // Initialize with today's date
    updateDateDisplay();

    // Add viewport scaling functionality
    window.addEventListener('resize', handleViewportScaling);
    window.addEventListener('load', handleViewportScaling);
    handleViewportScaling(); // Initialize scaling on startup
  };
  
  // Viewport scaling functionality
  const handleViewportScaling = () => {
    // Get the actual height of the content
    const appContainer = document.querySelector('.app-container');
    const contentHeight = appContainer.scrollHeight;
    
    // Store the content height as a CSS variable for reference
    document.documentElement.style.setProperty('--content-height', `${contentHeight}px`);
    
    // Get the current viewport height
    const viewportHeight = window.innerHeight;
    
    // If viewport is smaller than content, scale proportionally
    if (viewportHeight < contentHeight) {
      const scaleFactor = viewportHeight / contentHeight;
      document.documentElement.style.setProperty('--scale-factor', scaleFactor);
    } else {
      // Reset to normal size
      document.documentElement.style.setProperty('--scale-factor', 1);
    }
  };
  
  const updateAuthUI = () => {
    if (currentUser) {
      signInButton.classList.add('hidden');
      userMenu.classList.remove('hidden');
      userAvatar.src = currentUser.photoURL;
      userName.textContent = currentUser.displayName;
    } else {
      signInButton.classList.remove('hidden');
      userMenu.classList.add('hidden');
    }
  };
  
  const clearUI = () => {
    tasks = [];
    renderTasks();
  };
  
  const handleAuth = async () => {
    try {
      // Save local tasks before signing in
      const localTasks = tasks.length > 0 ? [...tasks] : null;
      const currentDateKey = getDateKey(currentDate);
      
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
      
      // If we had local tasks, check if we should migrate them
      if (localTasks && localTasks.length > 0) {
        const userDateKey = getDateKey(currentDate);
        const tasksRef = ref(database, `users/${auth.currentUser.uid}/tasks/${userDateKey}`);
        const snapshot = await get(tasksRef);
        
        // Only migrate if the user doesn't have tasks for this date
        if (!snapshot.exists()) {
          await set(tasksRef, localTasks.reduce((acc, task) => {
            acc[task.id] = task;
            return acc;
          }, {}));
        }
      }
    } catch (error) {
      console.error("Sign in error:", error);
      alert("Sign in failed. Please try again.");
    }
  };
  
  const handleSignOut = async () => {
    try {
      // Save any pending changes before signing out
      savePendingChanges();
      await signOut(auth);
      // After sign out, load tasks from local storage
      loadTasks();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };
  
  // Save any pending changes before performing important actions
  const savePendingChanges = () => {
    if (tasks.length > 0) {
      saveTasks();
    }
  };
  
  // Local storage helpers
  const LOCAL_STORAGE_PREFIX = 'threefive_';
  
  const saveTasksToLocalStorage = (dateKey, tasksData) => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`, JSON.stringify(tasksData));
      return true;
    } catch (error) {
      console.error("Error saving to localStorage:", error);
      return false;
    }
  };
  
  const loadTasksFromLocalStorage = (dateKey) => {
    try {
      const data = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error loading from localStorage:", error);
      return null;
    }
  };
  
  // Tasks CRUD operations
  const loadTasks = () => {
    const dateKey = getDateKey(currentDate);
    
    if (currentUser) {
      // Load from Firebase if user is logged in
      const tasksRef = ref(database, `users/${currentUser.uid}/tasks/${dateKey}`);
      
      get(tasksRef).then((snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          tasks = Object.values(data)
            .map(t => new Task(t.id, t.name, t.completed, t.order))
            .sort((a, b) => a.order - b.order);
          
          // If we have less than MIN_TASKS, add blank ones to reach minimum
          if (tasks.length < MIN_TASKS) {
            const additionalTasks = MIN_TASKS - tasks.length;
            for (let i = 0; i < additionalTasks; i++) {
              const id = `default-${Date.now()}-${i}`;
              tasks.push(new Task(id, '', false, tasks.length));
            }
            saveTasks();
          }
        } else {
          // Create default blank tasks if no tasks exist for today
          createDefaultTasks();
        }
        
        renderTasks();
        setupDragAndDrop();
        updateAddButtonVisibility();
        
        // Show/hide empty state message
        emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
      }).catch(error => {
        console.error("Error loading tasks from Firebase:", error);
      });
    } else {
      // Load from localStorage if no user is logged in
      const storedTasks = loadTasksFromLocalStorage(dateKey);
      
      if (storedTasks) {
        tasks = Object.values(storedTasks)
          .map(t => new Task(t.id, t.name, t.completed, t.order))
          .sort((a, b) => a.order - b.order);
        
        // Ensure minimum tasks
        if (tasks.length < MIN_TASKS) {
          const additionalTasks = MIN_TASKS - tasks.length;
          for (let i = 0; i < additionalTasks; i++) {
            const id = `default-${Date.now()}-${i}`;
            tasks.push(new Task(id, '', false, tasks.length));
          }
          saveTasks();
        }
      } else {
        // Create default blank tasks if no tasks exist
        createDefaultTasks();
      }
      
      renderTasks();
      setupDragAndDrop();
      updateAddButtonVisibility();
      
      // Show/hide empty state message
      emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
    }
  };
  
  const createDefaultTasks = () => {
    tasks = [];
    // Add 3 blank tasks
    for (let i = 0; i < MIN_TASKS; i++) {
      const id = `default-${Date.now()}-${i}`;
      tasks.push(new Task(id, '', false, i));
    }
    saveTasks();
  };
  
  const saveTasks = () => {
    const dateKey = getDateKey(currentDate);
    
    // Create an object with task IDs as keys
    const tasksObject = {};
    tasks.forEach((task, index) => {
      // Update order based on current position
      task.order = index;
      tasksObject[task.id] = task;
    });
    
    if (currentUser) {
      // Save to Firebase if user is logged in
      const tasksRef = ref(database, `users/${currentUser.uid}/tasks/${dateKey}`);
      set(tasksRef, tasksObject).catch(error => {
        console.error("Error saving tasks to Firebase:", error);
      });
    } else {
      // Save to localStorage if no user is logged in
      saveTasksToLocalStorage(dateKey, tasksObject);
    }
  };
  
  const addNewTask = () => {
    // Enforce MAX_TASKS limit
    if (tasks.length >= MAX_TASKS) {
      alert(`You can only have up to ${MAX_TASKS} tasks per day.`);
      return;
    }
    
    const id = Date.now().toString();
    const order = tasks.length;
    const newTask = new Task(id, '', false, order);
    
    tasks.push(newTask);
    saveTasks();
    renderTasks();
    
    // Recalculate scaling after adding a new task
    setTimeout(handleViewportScaling, 0);
  };
  
  const updateTask = (id, updates) => {
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex] = {...tasks[taskIndex], ...updates};
      saveTasks();
      return true;
    }
    return false;
  };
  
  const deleteTask = (id) => {
    // Can only delete tasks if we have more than MIN_TASKS
    if (tasks.length <= MIN_TASKS) {
      return false;
    }
    
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks.splice(taskIndex, 1);
      saveTasks();
      renderTasks();
      
      // Recalculate scaling after deleting a task
      setTimeout(handleViewportScaling, 0);
      return true;
    }
    return false;
  };
  
  const updateAddButtonVisibility = () => {
    // Hide add button if we have MAX_TASKS
    addTaskButton.style.display = tasks.length >= MAX_TASKS ? 'none' : 'flex';
  };
  
  // Render Tasks in the DOM
  const renderTasks = () => {
    // Clear previous task elements but keep the empty message
    const taskElements = tasksContainer.querySelectorAll('.task');
    taskElements.forEach(el => el.remove());
    
    // Show/hide empty message
    emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
    
    // Create and append task elements
    tasks.forEach(task => {
      const taskEl = createTaskElement(task);
      tasksContainer.appendChild(taskEl);
    });
    
    // Update add button visibility
    updateAddButtonVisibility();
    
    // Refresh the sortable instance
    setupDragAndDrop();
    
    // Recalculate scaling after tasks are rendered
    setTimeout(handleViewportScaling, 0);
  };
  
  const createTaskElement = (task) => {
    const taskEl = document.createElement('div');
    taskEl.className = `task ${task.completed ? 'completed' : ''}`;
    taskEl.dataset.id = task.id;
    
    // Checkbox for completion
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => {
      updateTask(task.id, { completed: checkbox.checked });
      taskEl.classList.toggle('completed', checkbox.checked);
    });
    
    // Editable text
    const textContainer = document.createElement('div');
    textContainer.className = 'task-text';
    
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = task.name;
    textInput.placeholder = 'Click to enter task...';
    textInput.readOnly = true;
    textInput.addEventListener('blur', () => {
      if (textInput.value.trim() !== task.name) {
        updateTask(task.id, { name: textInput.value.trim() });
      }
      textInput.readOnly = true;
    });
    textInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        textInput.blur();
      } else if (e.key === 'Escape') {
        textInput.value = task.name;
        textInput.blur();
      }
    });
    
    // Make text clickable for editing
    textInput.addEventListener('click', () => {
      if (textInput.readOnly) {
        textInput.readOnly = false;
        textInput.focus();
        textInput.setSelectionRange(0, textInput.value.length);
      }
    });
    
    textContainer.appendChild(textInput);
    
    // Add delete button only if we have more than MIN_TASKS
    if (tasks.length > MIN_TASKS) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-button';
      deleteBtn.setAttribute('aria-label', 'Delete task');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });
      
      // Append delete button
      taskEl.appendChild(checkbox);
      taskEl.appendChild(textContainer);
      taskEl.appendChild(deleteBtn);
    } else {
      // Just append the checkbox and text if we have MIN_TASKS or fewer
      taskEl.appendChild(checkbox);
      taskEl.appendChild(textContainer);
    }
    
    return taskEl;
  };
  
  // Drag and drop functionality
  const setupDragAndDrop = () => {
    // Destroy previous instance if it exists
    if (sortableInstance) {
      sortableInstance.destroy();
    }
    
    // Create new sortable instance
    sortableInstance = new Sortable(tasksContainer, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '.empty-state',
      onSort: () => {
        // Re-order tasks array based on DOM order
        const taskElements = tasksContainer.querySelectorAll('.task');
        const newTasksOrder = [];
        
        taskElements.forEach((el, index) => {
          const taskId = el.dataset.id;
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            task.order = index;
            newTasksOrder.push(task);
          }
        });
        
        // Update tasks array with new order
        tasks = newTasksOrder;
        saveTasks();
      }
    });
  };
  
  // Public methods
  return {
    init
  };
})();

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', App.init);