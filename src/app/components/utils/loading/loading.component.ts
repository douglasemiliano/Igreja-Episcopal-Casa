import { Component, inject } from '@angular/core';
import { LoadingService } from '../../../services/loading.service';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [],
  templateUrl: './loading.component.html',  // Agora o template está no HTML
  styleUrls: ['./loading.component.scss']   // Agora os estilos estão no SCSS
})
export class LoadingComponent {
  private loadingService: LoadingService = inject(LoadingService);
  isLoading: boolean = false;



  ngOnInit() {
    this.loadingService.loading$.subscribe({
      next: (loading) => {
        this.isLoading = loading;
      }
    })
  }
}